import { corsHeaders, guardRequest, jsonError, upstreamStatus } from '../shared/http'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

// Gemini multimodal via OpenRouter handles the speech-to-text pass. The audio
// travels as an `input_audio` content part (base64 + container format) exactly
// as documented at https://openrouter.ai/docs/features/multimodal/audio.
const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL ?? '~google/gemini-flash-latest'
const MAX_OUTPUT_TOKENS = Number(process.env.TRANSCRIBE_MAX_TOKENS ?? 2048)

// Netlify caps a synchronous invocation at ~30s; bail a beat early so a slow
// upstream turns into a clean 503 instead of a dead socket.
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 25_000)

// Netlify's request body ceiling is ~6MB once base64-encoded. 4.5MB of decoded
// audio leaves room for the JSON envelope; the client caps recordings well
// under this (90s of 16kHz mono PCM is ~2.9MB).
const MAX_AUDIO_BYTES = Number(process.env.MAX_AUDIO_BYTES ?? 4.5 * 1024 * 1024)

// Container formats OpenRouter accepts for `input_audio`. webm is deliberately
// absent — it is not on the accepted list, so the client transcodes to wav.
const ALLOWED_FORMATS = ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac', 'aiff']

const TRANSCRIBE_PROMPT =
  'Transcribe the speech in this audio verbatim. Output only the spoken words as ' +
  'plain text, with normal punctuation and capitalization. Do not translate, ' +
  'summarize, comment, or add speaker labels, timestamps, quotation marks or ' +
  'formatting. If the audio contains no intelligible speech, output nothing at all.'

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

export default async (req: Request): Promise<Response> => {
  const guard = guardRequest(req)
  if (guard) return guard

  const origin = req.headers.get('origin')

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('transcribe: OPENROUTER_API_KEY is not configured')
    return jsonError('Transcription is not configured on this deployment.', 500, origin)
  }

  try {
    let body: { audio?: unknown; format?: unknown }
    try {
      body = (await req.json()) as { audio?: unknown; format?: unknown }
    } catch {
      return jsonError('Invalid JSON body', 400, origin)
    }

    const audio = body.audio
    if (typeof audio !== 'string' || audio.length === 0) {
      return jsonError('Missing audio field', 400, origin)
    }

    const format = typeof body.format === 'string' ? body.format.toLowerCase() : 'wav'
    if (!ALLOWED_FORMATS.includes(format)) {
      return jsonError('Unsupported audio format', 400, origin)
    }

    // base64 carries 3 bytes per 4 characters.
    if (audio.length * 0.75 > MAX_AUDIO_BYTES) {
      return jsonError('Recording is too long to process. Try a shorter one.', 413, origin)
    }

    if (format === 'wav' && wavHasSpeechEnergy(Buffer.from(audio, 'base64')) === false) {
      return Response.json({ text: '' }, { headers: corsHeaders(origin) })
    }

    let response: Response
    try {
      response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        body: JSON.stringify({
          model: TRANSCRIBE_MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: TRANSCRIBE_PROMPT },
                { type: 'input_audio', input_audio: { data: audio, format } },
              ],
            },
          ],
        }),
      })
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError'
      console.error('transcribe: upstream request failed', err)
      return jsonError(
        timedOut
          ? 'Transcription timed out. Try a shorter recording.'
          : 'Transcription service is unreachable. Try again in a moment.',
        503,
        origin,
      )
    }

    if (!response.ok) {
      // Vendor error text can carry account/billing detail — log it, never ship it.
      const detail = await response.text().catch(() => '<unreadable>')
      console.error(`transcribe: upstream ${response.status} ${response.statusText}: ${detail}`)
      return jsonError(
        response.status === 429
          ? 'Transcription is rate limited right now. Try again in a moment.'
          : 'Transcription service failed. Try again in a moment.',
        upstreamStatus(response.status),
        origin,
      )
    }

    let data: { choices?: Array<{ message?: { content?: unknown } }> }
    try {
      data = (await response.json()) as typeof data
    } catch (err) {
      console.error('transcribe: could not parse upstream JSON', err)
      return jsonError('Transcription service returned an unreadable response.', 502, origin)
    }

    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      console.error(
        'transcribe: unexpected upstream payload shape',
        JSON.stringify(data).slice(0, 500),
      )
      return jsonError('Transcription service returned an unexpected response.', 502, origin)
    }

    return Response.json({ text: cleanTranscript(content) }, { headers: corsHeaders(origin) })
  } catch (err) {
    console.error('transcribe: unhandled failure', err)
    return jsonError('Transcription failed. Try again in a moment.', 500, origin)
  }
}

export const config = {
  path: '/api/transcribe',
}
