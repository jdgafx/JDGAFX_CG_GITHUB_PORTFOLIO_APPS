import { corsHeaders, guardRequest, jsonError, providerFailure, upstreamStatus } from '../shared/http'
import { createRecorder } from '../shared/trace'

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen'

// A fixed server constant. The browser never chooses the speech-to-text model,
// and no picker exposes it.
const TRANSCRIBE_MODEL = 'nova-3'

// Netlify caps a synchronous invocation at ~30s; bail a beat early so a slow
// upstream turns into a clean error instead of a dead socket.
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 25_000)

// Netlify's request body ceiling is ~6MB once base64-encoded. 4.5MB of decoded
// audio leaves room for the JSON envelope; the client caps recordings well
// under this (90s of 16kHz mono PCM is ~2.9MB).
const MAX_AUDIO_BYTES = Number(process.env.MAX_AUDIO_BYTES ?? 4.5 * 1024 * 1024)

// The client transcodes to wav when possible; these are the accepted upload
// labels for the fallback containers it can preserve.
const ALLOWED_FORMATS = ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac', 'aiff']

const CONTENT_TYPES: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  aiff: 'audio/aiff',
}

// The model occasionally wraps its answer or narrates an empty clip; strip the
// well-known shapes so the client sees either real words or an empty string.
function cleanTranscript(raw: string): string {
  let text = raw.trim()
  if (text.length >= 2 && /^["'“‘]/.test(text) && /["'”’]$/.test(text)) {
    text = text.slice(1, -1).trim()
  }
  text = text.replace(/^transcript(ion)?\s*:\s*/i, '').trim()
  // Bracketed-only output such as "[no speech]" or "(silence)" means nothing was said.
  if (/^[[(][^\])]*[\])]$/.test(text)) return ''
  return text
}

// Handed silence, the model invents plausible sentences rather than returning
// nothing (a 3s silent clip came back as "And it can get confusing."). The
// browser already screens for speech energy; this is the same guard for
// anything that reaches the endpoint another way, and it saves the API call.
// Thresholds mirror SILENCE_PEAK / MIN_LOUD_SAMPLE_RATIO in src/lib/audio.ts.
const SILENCE_PEAK = 0.02
const MIN_LOUD_SAMPLE_RATIO = 0.005

// Returns null when the buffer is not PCM16 wav we can read, so callers can
// fail open rather than reject a clip they simply could not measure.
function wavHasSpeechEnergy(audio: Buffer): boolean | null {
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF') return null
  if (audio.toString('ascii', 8, 12) !== 'WAVE') return null

  let offset = 12
  let bitsPerSample = 0
  while (offset + 8 <= audio.length) {
    const chunkId = audio.toString('ascii', offset, offset + 4)
    const chunkSize = audio.readUInt32LE(offset + 4)
    const body = offset + 8

    if (chunkId === 'fmt ' && body + 16 <= audio.length) {
      bitsPerSample = audio.readUInt16LE(body + 14)
    } else if (chunkId === 'data') {
      if (bitsPerSample !== 16) return null
      const end = Math.min(body + chunkSize, audio.length)
      const total = Math.floor((end - body) / 2)
      if (total === 0) return null

      let loud = 0
      let peak = 0
      for (let i = 0; i < total; i++) {
        const level = Math.abs(audio.readInt16LE(body + i * 2)) / 0x8000
        if (level > peak) peak = level
        if (level > SILENCE_PEAK) loud++
      }
      return peak >= SILENCE_PEAK && loud / total >= MIN_LOUD_SAMPLE_RATIO
    }

    offset = body + chunkSize + (chunkSize % 2)
  }
  return null
}

function previewOf(text: string): string {
  return text.length > 120 ? `"${text.slice(0, 117)}..."` : `"${text}"`
}

export default async (req: Request): Promise<Response> => {
  const guard = guardRequest(req)
  if (guard) return guard

  const origin = req.headers.get('origin')
  const run = createRecorder()
  const reply = (message: string, status: number) =>
    jsonError(message, status, origin, { trace: run.steps, totalMs: run.elapsed() })

  try {
    let body: { audio?: unknown; format?: unknown }
    try {
      body = (await req.json()) as { audio?: unknown; format?: unknown }
    } catch {
      run.add('audio received', 'failed', 'The request body was not JSON')
      return reply('The request was not valid JSON.', 400)
    }

    const audio = body.audio
    if (typeof audio !== 'string' || audio.length === 0) {
      run.add('audio received', 'failed', 'No audio was sent')
      return reply('No audio was received. Try recording again.', 400)
    }

    const format = typeof body.format === 'string' ? body.format.toLowerCase() : 'wav'
    if (!ALLOWED_FORMATS.includes(format)) {
      run.add('audio received', 'failed', 'The audio format is not supported')
      return reply('Unsupported audio format', 400)
    }

    // base64 carries 3 bytes per 4 characters.
    if (audio.length * 0.75 > MAX_AUDIO_BYTES) {
      run.add('audio received', 'failed', 'The recording is larger than the upload limit')
      return reply('Recording is too long to process. Try a shorter one.', 413)
    }

    const clip = Buffer.from(audio, 'base64')
    run.add('audio received', 'ok', `${format.toUpperCase()}, ${Math.round(clip.length / 1024)} KB`)

    if (format === 'wav' && wavHasSpeechEnergy(clip) === false) {
      run.add('speech to text', 'skipped', 'No speech energy in the clip, so Deepgram was not called')
      return Response.json(
        { result: '', trace: run.steps, model: TRANSCRIBE_MODEL, totalMs: run.elapsed() },
        { headers: corsHeaders(origin) },
      )
    }

    const apiKey = process.env.DEEPGRAM_API_KEY
    if (!apiKey) {
      console.error('transcribe: DEEPGRAM_API_KEY is not configured')
      run.add('speech to text', 'failed', 'No speech-to-text provider is configured on this deployment')
      return reply('Transcription is not configured on this deployment.', 500)
    }

    let response: Response
    try {
      response = await fetch(`${DEEPGRAM_URL}?model=${TRANSCRIBE_MODEL}&smart_format=true`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': CONTENT_TYPES[format],
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        body: clip,
      })
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError'
      console.error('transcribe: upstream request failed', err)
      run.add(
        'speech to text',
        'failed',
        timedOut ? 'No reply before the time limit' : 'The request did not reach Deepgram',
      )
      return reply(
        timedOut
          ? 'Transcription timed out. Try a shorter recording.'
          : 'Transcription service is unreachable. Try again in a moment.',
        503,
      )
    }

    if (!response.ok) {
      // Vendor error text can carry account or billing detail. Log it, never ship it.
      const detail = await response.text().catch(() => '<unreadable>')
      console.error(`transcribe: upstream ${response.status} ${response.statusText}: ${detail}`)
      run.add('speech to text', 'failed', `HTTP ${response.status} from Deepgram`)
      return reply(providerFailure('The transcription service', response.status), upstreamStatus(response.status))
    }

    let data: {
      metadata?: { model_info?: { name?: string }; duration?: number }
      results?: { channels?: Array<{ alternatives?: Array<{ transcript?: unknown }> }> }
    }
    try {
      data = (await response.json()) as typeof data
    } catch (err) {
      console.error('transcribe: could not parse upstream JSON', err)
      run.add('speech to text', 'failed', 'The reply was not JSON')
      return reply('Transcription service returned an unreadable response.', 502)
    }

    const model = data.metadata?.model_info?.name ?? TRANSCRIBE_MODEL
    const seconds = typeof data.metadata?.duration === 'number' ? `, ${data.metadata.duration.toFixed(1)} s of audio` : ''
    run.add('speech to text', 'ok', `${model}${seconds}`)

    const content = data.results?.channels?.[0]?.alternatives?.[0]?.transcript
    if (typeof content !== 'string') {
      console.error('transcribe: unexpected upstream payload shape', JSON.stringify(data).slice(0, 500))
      run.add('parse and validate', 'failed', 'The reply had no transcript field')
      return reply('Transcription service returned an unexpected response.', 502)
    }

    const text = cleanTranscript(content)
    run.add('parse and validate', 'ok', text ? previewOf(text) : 'No words in the clip')
    return Response.json(
      { result: text, trace: run.steps, model, totalMs: run.elapsed() },
      { headers: corsHeaders(origin) },
    )
  } catch (err) {
    console.error('transcribe: unhandled failure', err)
    run.add('server error', 'failed', 'Unexpected failure in the transcription function')
    return reply('Transcription failed. Try again in a moment.', 500)
  }
}

export const config = {
  path: '/api/transcribe',
}
