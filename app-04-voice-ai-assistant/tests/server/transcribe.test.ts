import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/transcribe'
import {
  ORIGIN,
  PLACEHOLDER,
  bodyOf,
  headerOf,
  jsonResponse,
  request,
  restoreEnv,
  setEnv,
  stubFetch,
  urlOf,
} from '../helpers'

const URL_TRANSCRIBE = 'http://localhost/api/transcribe'
const TOO_LONG = 'Recording is too long to process. Try a shorter one.'
const UNREADABLE_AUDIO = 'The recording could not be read. Try recording again.'
const MP3 = Buffer.from('ID3 test audio').toString('base64')

const DEEPGRAM_OK = {
  metadata: { model_info: { name: 'nova-3' }, duration: 1 },
  results: { channels: [{ alternatives: [{ transcript: 'pong' }] }] },
}

// A 16-bit mono 16 kHz wav. Samples alternate loud and quiet, or stay at zero.
function wavBase64(sample: (index: number) => number): string {
  const samples = Array.from({ length: 16_000 }, (_, index) => sample(index))
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((value, index) => data.writeInt16LE(value, index * 2))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16_000, 24)
  header.writeUInt32LE(32_000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data]).toString('base64')
}

const LOUD_WAV = wavBase64(index => (index % 2 === 0 ? 12_000 : -12_000))
const SILENT_WAV = wavBase64(() => 0)

describe('transcribe function', () => {
  beforeEach(() => {
    setEnv('DEEPGRAM_API_KEY', PLACEHOLDER)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    restoreEnv()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the transcript Deepgram nova-3 heard', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(DEEPGRAM_OK))

    const res = await handler(request(URL_TRANSCRIBE, { json: { audio: MP3, format: 'mp3' } }))
    const body = await bodyOf(res)

    expect(res.status).toBe(200)
    expect(body.result).toBe('pong')
    expect(body.model).toBe('nova-3')
    expect(body.trace?.map(step => [step.name, step.status])).toEqual([
      ['audio received', 'ok'],
      ['speech to text', 'ok'],
      ['parse and validate', 'ok'],
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(urlOf(fetchMock)).toBe('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true')
    expect(headerOf(fetchMock, 0, 'authorization')).toBe(`Token ${PLACEHOLDER}`)
    expect(headerOf(fetchMock, 0, 'content-type')).toBe('audio/mpeg')
  })

  it('sends a speech WAV clip to Deepgram as audio/wav', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(DEEPGRAM_OK))

    const res = await handler(request(URL_TRANSCRIBE, { json: { audio: LOUD_WAV, format: 'wav' } }))

    expect((await bodyOf(res)).result).toBe('pong')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(headerOf(fetchMock, 0, 'content-type')).toBe('audio/wav')
  })

  it('skips Deepgram for a silent WAV clip and returns an empty transcript', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(DEEPGRAM_OK))

    const res = await handler(request(URL_TRANSCRIBE, { json: { audio: SILENT_WAV, format: 'wav' } }))
    const body = await bodyOf(res)

    expect(res.status).toBe(200)
    expect(body.result).toBe('')
    expect(body.trace?.find(step => step.name === 'speech to text')?.status).toBe('skipped')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 405 to a GET request', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(DEEPGRAM_OK))

    const res = await handler(request(URL_TRANSCRIBE, { method: 'GET' }))

    expect(res.status).toBe(405)
    expect((await bodyOf(res)).error).toBe('Method not allowed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 403 for an origin that is not allowed', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(DEEPGRAM_OK))

    const res = await handler(request(URL_TRANSCRIBE, { json: { audio: MP3 }, origin: 'https://evil.example' }))

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a missing audio field', { format: 'mp3' }, 'No audio was received. Try recording again.'],
    ['an empty audio field', { audio: '', format: 'mp3' }, 'No audio was received. Try recording again.'],
    ['an unsupported format', { audio: MP3, format: 'video/mp4' }, 'Unsupported audio format'],
    ['a format that is not text', { audio: MP3, format: 5 }, 'Unsupported audio format'],
    ['audio that is not base64', { audio: 'abc$', format: 'mp3' }, UNREADABLE_AUDIO],
  ])('answers 400 for %s', async (_label, payload, expected) => {
    const fetchMock = stubFetch(async () => jsonResponse(DEEPGRAM_OK))

    const res = await handler(request(URL_TRANSCRIBE, { json: payload }))

    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toBe(expected)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 400 when the audio is one byte above MAX_AUDIO_BYTES', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(DEEPGRAM_OK))
    const oversize = Buffer.alloc(4_718_592 + 1).toString('base64')

    const res = await handler(request(URL_TRANSCRIBE, { json: { audio: oversize, format: 'mp3' } }))

    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toBe(TOO_LONG)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 400 when the declared body is above the upload limit', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(DEEPGRAM_OK))

    const res = await handler(
      request(URL_TRANSCRIBE, { json: { audio: MP3, format: 'mp3' }, headers: { 'content-length': '99999999' } }),
    )

    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toBe(TOO_LONG)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 400 when the body is not JSON', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(DEEPGRAM_OK))

    const res = await handler(request(URL_TRANSCRIBE, { body: 'not json' }))

    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toBe('The request was not valid JSON.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 500 when no Deepgram key is configured, without calling Deepgram', async () => {
    setEnv('DEEPGRAM_API_KEY', '')
    const fetchMock = stubFetch(async () => jsonResponse(DEEPGRAM_OK))

    const res = await handler(request(URL_TRANSCRIBE, { json: { audio: MP3, format: 'mp3' } }))

    expect(res.status).toBe(500)
    expect((await bodyOf(res)).error).toBe('Transcription is not configured on this deployment.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [401, 502, 'The transcription service rejected the key or is out of credit.'],
    [402, 502, 'The transcription service rejected the key or is out of credit.'],
    [404, 502, 'The transcription service did not accept the request (HTTP 404).'],
    [429, 429, 'Rate limited, try again in a minute.'],
    [500, 503, 'The transcription service did not answer in time.'],
  ])('maps a Deepgram %i to status %i with plain copy', async (upstream, status, message) => {
    stubFetch(async () => jsonResponse({ err_msg: 'vendor detail acct_9921' }, upstream))

    const res = await handler(request(URL_TRANSCRIBE, { json: { audio: MP3, format: 'mp3' } }))
    const text = JSON.stringify(await bodyOf(res))

    expect(res.status).toBe(status)
    expect(text).toContain(message)
    expect(text).not.toContain('acct_9921')
  })

  it.each(['AbortError', 'TimeoutError'])('answers a Deepgram %s deadline with the did-not-answer copy', async name => {
    stubFetch(async () => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name })
    })

    const res = await handler(request(URL_TRANSCRIBE, { json: { audio: MP3, format: 'mp3' } }))

    expect(res.status).toBe(503)
    expect((await bodyOf(res)).error).toBe('The transcription service did not answer in time.')
  })

  it('answers 503 when Deepgram cannot be reached', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })

    const res = await handler(request(URL_TRANSCRIBE, { json: { audio: MP3, format: 'mp3' } }))

    expect(res.status).toBe(503)
    expect((await bodyOf(res)).error).toBe('The transcription service could not be reached. Try again in a moment.')
  })

  it('answers 502 when the Deepgram reply is not JSON', async () => {
    stubFetch(async () => new Response('<html>', { status: 200 }))

    const res = await handler(request(URL_TRANSCRIBE, { json: { audio: MP3, format: 'mp3' } }))

    expect(res.status).toBe(502)
    expect((await bodyOf(res)).error).toBe('The transcription service returned an unreadable response.')
  })

  it('answers 502 when the Deepgram reply has no transcript field', async () => {
    stubFetch(async () => jsonResponse({ results: {} }))

    const res = await handler(request(URL_TRANSCRIBE, { json: { audio: MP3, format: 'mp3' } }))

    expect(res.status).toBe(502)
    expect((await bodyOf(res)).error).toBe('The transcription service returned an unexpected response.')
  })

  it('reports no words when Deepgram returns only bracketed text', async () => {
    stubFetch(async () =>
      jsonResponse({ results: { channels: [{ alternatives: [{ transcript: '[no speech]' }] }] } }),
    )

    const res = await handler(request(URL_TRANSCRIBE, { json: { audio: MP3, format: 'mp3' } }))
    const body = await bodyOf(res)

    expect(res.status).toBe(200)
    expect(body.result).toBe('')
    expect(body.trace?.find(step => step.name === 'parse and validate')?.detail).toBe('No words in the clip')
  })

  it('strips surrounding quotes and a transcript label from the words', async () => {
    stubFetch(async () =>
      jsonResponse({ results: { channels: [{ alternatives: [{ transcript: '"Transcript: pong"' }] }] } }),
    )

    const res = await handler(request(URL_TRANSCRIBE, { json: { audio: MP3, format: 'mp3' } }))

    expect((await bodyOf(res)).result).toBe('pong')
  })

  it('answers 500 with a generic message when reading the request fails', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(DEEPGRAM_OK))
    const broken = new Request(URL_TRANSCRIBE, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: new ReadableStream({
        start(controller) {
          controller.error(new Error('socket reset'))
        },
      }),
      duplex: 'half',
    } as RequestInit)

    const res = await handler(broken)
    const text = JSON.stringify(await bodyOf(res))

    expect(res.status).toBe(500)
    expect(text).toContain('Transcription failed. Try again in a moment.')
    expect(text).not.toContain('socket reset')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
