import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunError, parseTrace, transcribe } from '../../src/lib/api'
import { jsonResponse, stubFetch, urlOf, type FetchMock } from '../helpers'

const UNREACHABLE = 'Could not reach the server. Check your connection and try again.'

async function failureOf(call: Promise<unknown>): Promise<RunError> {
  try {
    await call
  } catch (err) {
    if (err instanceof RunError) return err
    throw err
  }
  throw new Error('expected the call to fail')
}

function sentBody(mock: FetchMock): Record<string, unknown> {
  return JSON.parse(String(mock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
}

describe('transcribe (browser side)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the transcript the server heard and sends the clip as JSON', async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse({
        result: 'pong',
        model: 'nova-3',
        trace: [{ name: 'speech to text', status: 'ok', ms: 500, detail: 'nova-3' }],
        totalMs: 520,
      }),
    )

    const result = await transcribe({ data: 'AAAA', format: 'wav' })

    expect(urlOf(fetchMock)).toBe('/api/transcribe')
    expect(sentBody(fetchMock)).toEqual({ audio: 'AAAA', format: 'wav' })
    expect(result).toMatchObject({ text: 'pong', model: 'nova-3', totalMs: 520 })
  })

  it('reports a dropped connection with the same plain copy', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })

    const error = await failureOf(transcribe({ data: 'AAAA', format: 'wav' }))

    expect(error.message).toBe(UNREACHABLE)
    expect(error.trace[0]).toMatchObject({ name: 'speech to text', status: 'failed' })
  })

  it('reads a platform 504, which is not JSON, with the transcription copy', async () => {
    stubFetch(async () => new Response('<html>Gateway Timeout</html>', { status: 504 }))

    const error = await failureOf(transcribe({ data: 'AAAA', format: 'wav' }))

    expect(error.message).toBe('The transcription service did not answer in time.')
  })

  it('reports an upload the platform refused as too long', async () => {
    stubFetch(async () => new Response('Payload Too Large', { status: 413 }))

    const error = await failureOf(transcribe({ data: 'AAAA', format: 'wav' }))

    expect(error.message).toBe('That recording is too long to send. Try a shorter one.')
  })
})

describe('parseTrace', () => {
  const step = { name: 'tool call', status: 'ok', ms: 540, detail: 'Lisbon: 21.9 °C' }

  it('keeps the call and the source link of a tool step, and drops a source that is not http(s)', () => {
    const [kept, dropped] = parseTrace([
      { ...step, call: 'weather("Lisbon")', source: 'https://api.open-meteo.com/v1/forecast?x=1' },
      { ...step, source: 'javascript:alert(1)' },
    ])
    expect(kept).toMatchObject({ call: 'weather("Lisbon")', source: 'https://api.open-meteo.com/v1/forecast?x=1' })
    expect(dropped.source).toBeUndefined()
  })

  it('reads the weather reading and drops one without a time', () => {
    const reading = { time: '2026-10-09T19:15', zone: 'Europe/Lisbon', abbreviation: 'GMT+1', intervalSeconds: 900, fetchedAt: '2026-10-09T18:20:03.000Z' }
    expect(parseTrace([{ ...step, reading }])[0].reading).toEqual(reading)
    expect(parseTrace([{ ...step, reading: { zone: 'x' } }])[0].reading).toBeUndefined()
  })

  it('drops steps with an unknown status or missing fields', () => {
    expect(parseTrace([{ ...step, status: 'weird' }, { name: 'x' }, null, 'text'])).toEqual([])
  })
})
