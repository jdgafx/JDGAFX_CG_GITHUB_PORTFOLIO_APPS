import {
  corsHeaders,
  guardRequest,
  isDeadlineError,
  jsonError,
  providerFailure,
  readJsonBody,
  upstreamStatus,
} from '../shared/http'
import { withDeadline } from '../shared/deadline'
import { createRecorder } from '../shared/trace'

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen'
const SERVICE = 'The transcription service'
const TOO_LONG = 'Recording is too long to process. Try a shorter one.'

// A fixed server constant. The browser never chooses the speech-to-text model,
// and no picker exposes it.
const TRANSCRIBE_MODEL = 'nova-3'

// Netlify caps a synchronous invocation at ~30s; bail a beat early so a slow
// upstream turns into a clean error instead of a dead socket.
const UPSTREAM_TIMEOUT_MS = 25_000

// The cap applies to the decoded audio. Its base64 form is already about 6 MiB before
// the JSON envelope is added, at the edge of Netlify's request body ceiling (about
// 6 MB), so the platform ceiling is the real bound. The client caps recordings far
// lower: 90s of 16kHz mono PCM is about 2.9 MB.
const MAX_AUDIO_BYTES = 4.5 * 1024 * 1024

// The body limit is the base64 size of the audio plus 64 KiB for the JSON envelope.
const MAX_BODY_BYTES = Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 64 * 1024

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

// The client transcodes to wav when possible; these are the accepted upload
// labels for the fallback containers it can preserve.
const CONTENT_TYPES = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  aiff: 'audio/aiff',
} as const

type AudioFormat = keyof typeof CONTENT_TYPES

function isAudioFormat(value: string): value is AudioFormat {
  return Object.hasOwn(CONTENT_TYPES, value)
}

// The format is optional and defaults to wav. Any other value must be a listed label.
function parseFormat(raw: unknown): AudioFormat | null {
  if (raw === undefined) return 'wav'
  if (typeof raw !== 'string') return null
  const lower = raw.toLowerCase()
  return isAudioFormat(lower) ? lower : null
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

// The fields this endpoint reads from the upstream reply. Each one may be absent.
interface DeepgramReply {
  metadata?: { model_info?: { name?: unknown }; duration?: unknown }
  results?: { channels?: Array<{ alternatives?: Array<{ transcript?: unknown }> }> }
}

export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin')
  const run = createRecorder()
  const reply = (message: string, status: number) =>
    jsonError(message, status, origin, { trace: run.steps, totalMs: run.elapsed() })

  try {
    const guard = guardRequest(req)
    if (guard) return guard

    const body = await readJsonBody(req, MAX_BODY_BYTES)
    if (!body.ok && body.reason === 'too-large') {
      run.add('audio received', 'failed', 'The request body is larger than the upload limit')
      return reply(TOO_LONG, 400)
    }
    if (!body.ok) {
      run.add('audio received', 'failed', 'The request body was not JSON')
      return reply('The request was not valid JSON.', 400)
    }
    const { fields } = body

    const audio = fields.audio
    if (typeof audio !== 'string' || audio.length === 0) {
      run.add('audio received', 'failed', 'No audio was sent')
      return reply('No audio was received. Try recording again.', 400)
    }

    const format = parseFormat(fields.format)
    if (format === null) {
      run.add('audio received', 'failed', 'The audio format is not supported')
      return reply('Unsupported audio format', 400)
    }

    // base64 carries 3 bytes per 4 characters.
    if (audio.length * 0.75 > MAX_AUDIO_BYTES) {
      run.add('audio received', 'failed', 'The recording is larger than the upload limit')
      return reply(TOO_LONG, 400)
    }
    if (audio.length % 4 !== 0 || !BASE64.test(audio)) {
      run.add('audio received', 'failed', 'The audio is not valid base64')
      return reply('The recording could not be read. Try recording again.', 400)
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

    // The deadline covers the body read as well as the headers, so a reply that stalls midway ends at the limit.
    type Heard =
      | { kind: 'reply'; data: DeepgramReply | null }
      | { kind: 'http'; status: number; detail: string }
      | { kind: 'unreadable'; error: unknown }
    let heard: Heard
    try {
      heard = await withDeadline<Heard>(UPSTREAM_TIMEOUT_MS, undefined, async signal => {
        const response = await fetch(`${DEEPGRAM_URL}?model=${TRANSCRIBE_MODEL}&smart_format=true`, {
          method: 'POST',
          headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': CONTENT_TYPES[format],
          },
          signal,
          body: clip,
        })
        if (!response.ok) return { kind: 'http', status: response.status, detail: await response.text().catch(() => '<unreadable>') }
        try {
          return { kind: 'reply', data: (await response.json()) as DeepgramReply | null }
        } catch (error) {
          if (isDeadlineError(error)) throw error
          return { kind: 'unreadable', error }
        }
      })
    } catch (err) {
      console.error('transcribe: upstream request failed', err)
      if (isDeadlineError(err)) {
        run.add('speech to text', 'failed', 'No reply before the time limit')
        return reply(`${SERVICE} did not answer in time.`, 503)
      }
      run.add('speech to text', 'failed', 'The request did not reach Deepgram')
      return reply(`${SERVICE} could not be reached. Try again in a moment.`, 503)
    }

    if (heard.kind === 'http') {
      // Vendor error text can carry account or billing detail. Log it, never ship it.
      console.error(`transcribe: upstream ${heard.status}: ${heard.detail}`)
      run.add('speech to text', 'failed', `HTTP ${heard.status} from Deepgram`)
      return reply(providerFailure(SERVICE, heard.status), upstreamStatus(heard.status))
    }

    if (heard.kind === 'unreadable') {
      console.error('transcribe: could not parse upstream JSON', heard.error)
      run.add('speech to text', 'failed', 'The reply was not JSON')
      return reply(`${SERVICE} returned an unreadable response.`, 502)
    }
    const data = heard.data

    const name = data?.metadata?.model_info?.name
    const model = typeof name === 'string' ? name : TRANSCRIBE_MODEL
    const duration = data?.metadata?.duration
    const seconds = typeof duration === 'number' ? `, ${duration.toFixed(1)} s of audio` : ''
    run.add('speech to text', 'ok', `${model}${seconds}`)

    const content = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript
    if (typeof content !== 'string') {
      console.error('transcribe: unexpected upstream payload shape')
      run.add('parse and validate', 'failed', 'The reply had no transcript field')
      return reply(`${SERVICE} returned an unexpected response.`, 502)
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
