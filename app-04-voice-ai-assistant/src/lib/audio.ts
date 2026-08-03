// Recording + upload encoding.
//
// OpenRouter's `input_audio` part accepts wav / mp3 / ogg / flac / m4a / aac /
// aiff (https://openrouter.ai/docs/features/multimodal/audio) — notably NOT
// webm, which is what Chrome's MediaRecorder produces. Every browser can decode
// the container it just recorded, so we decode locally and re-encode to 16kHz
// mono PCM wav: one format the API always accepts, and small enough to stay
// under Netlify's request ceiling.

export const MAX_RECORDING_MS = Number(import.meta.env.VITE_MAX_RECORDING_MS ?? 90_000)

// Netlify's ~6MB base64 request ceiling, minus room for the JSON envelope.
// Kept in step with MAX_AUDIO_BYTES in netlify/functions/transcribe.ts.
export const MAX_AUDIO_BYTES = 4.5 * 1024 * 1024

// 16kHz mono is the standard speech-recognition rate: ~32KB/s, so a full 90s
// recording lands near 2.9MB.
const TARGET_SAMPLE_RATE = 16_000

const RECORDER_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
]

export interface EncodedAudio {
  data: string
  format: string
}

export function isRecordingSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  )
}

// Returns the first container this browser can actually record, or null when
// none of them are supported (older WebKit builds).
export function pickRecorderMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  if (typeof MediaRecorder.isTypeSupported !== 'function') return ''
  for (const mimeType of RECORDER_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mimeType)) return mimeType
  }
  return null
}

// Fallback path only: map a recorded container onto an OpenRouter format name.
// Returns null for containers the API will not accept.
function formatFromMimeType(mimeType: string): string | null {
  if (mimeType.includes('mp4') || mimeType.includes('m4a') || mimeType.includes('aac')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3'
  return null
}

export function createAudioContext(): AudioContext {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) throw new Error('AUDIO_UNSUPPORTED')
  return new Ctor()
}

function getOfflineAudioContext(frames: number): OfflineAudioContext {
  const Ctor =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext
  if (!Ctor) throw new Error('AUDIO_UNSUPPORTED')
  return new Ctor(1, frames, TARGET_SAMPLE_RATE)
}

// Decode whatever the recorder produced, then render it down to one 16kHz
// channel. Mixing to mono is handled by the single-channel destination.
async function toMono16k(blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer()
  const context = createAudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await context.decodeAudioData(arrayBuffer)
  } finally {
    void context.close()
  }

  const frames = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE)
  if (frames < 1) throw new Error('EMPTY_RECORDING')

  const offline = getOfflineAudioContext(frames)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  return offline.startRendering()
}

// Handed silence, the transcription model invents plausible sentences (a 3s
// silent clip came back as "And it can get confusing."), and no text filter can
// reliably catch that. So a clip with no speech energy never leaves the browser.
// -34 dBFS peak still admits a quiet talker sitting back from the mic.
const SILENCE_PEAK = 0.02
const MIN_LOUD_SAMPLE_RATIO = 0.005

function hasSpeechEnergy(buffer: AudioBuffer): boolean {
  const samples = buffer.getChannelData(0)
  let loud = 0
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const level = Math.abs(samples[i])
    if (level > peak) peak = level
    if (level > SILENCE_PEAK) loud++
  }
  // A lone click can clear the peak bar, so also require sustained level.
  return peak >= SILENCE_PEAK && loud / samples.length >= MIN_LOUD_SAMPLE_RATIO
}

function encodeWav(buffer: AudioBuffer): Uint8Array {
  const samples = buffer.getChannelData(0)
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += 2
  }

  return bytes
}

// Chunked so a multi-megabyte recording does not blow the argument limit of
// String.fromCharCode.
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

// getUserMedia rejects for very different reasons and the fix differs for each,
// so the message has to name the actual problem.
export function micErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access blocked — enable it in your browser’s address-bar permissions, then try again.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone found. Use the text input below to chat.'
    case 'NotReadableError':
      return 'The microphone is in use by another app. Close it and try again.'
    case 'NotSupportedError':
      return 'This browser cannot record audio. Use the text input below, or try Chrome, Edge, Firefox or Safari.'
    default:
      return 'Could not start recording. Use the text input below to chat.'
  }
}

export class AudioTooLargeError extends Error {
  constructor() {
    super(
      `Recording is too long to send. Keep it under ${Math.round(MAX_RECORDING_MS / 1000)} seconds.`,
    )
    this.name = 'AudioTooLargeError'
  }
}

export class AudioEncodingError extends Error {
  constructor() {
    super('This browser could not prepare the recording for transcription.')
    this.name = 'AudioEncodingError'
  }
}

export class NoSpeechError extends Error {
  constructor() {
    super('No speech detected. Try speaking louder or closer to the microphone.')
    this.name = 'NoSpeechError'
  }
}

// Produces the { data, format } pair the transcribe endpoint expects. Falls
// back to shipping the original container when local decoding is unavailable
// and the container is one the API accepts anyway.
export async function encodeForUpload(blob: Blob): Promise<EncodedAudio> {
  if (blob.size === 0) throw new AudioEncodingError()

  let bytes: Uint8Array
  let format: string
  try {
    const mono = await toMono16k(blob)
    if (!hasSpeechEnergy(mono)) throw new NoSpeechError()
    bytes = encodeWav(mono)
    format = 'wav'
  } catch (err) {
    if (err instanceof NoSpeechError) throw err
    const fallbackFormat = formatFromMimeType(blob.type || '')
    if (!fallbackFormat) {
      console.error('audio: could not transcode recording', err)
      throw new AudioEncodingError()
    }
    bytes = new Uint8Array(await blob.arrayBuffer())
    format = fallbackFormat
  }

  if (bytes.byteLength > MAX_AUDIO_BYTES) throw new AudioTooLargeError()

  return { data: toBase64(bytes), format }
}
