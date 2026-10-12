import { describe, expect, it, vi } from 'vitest'
import { isStale, loadRecording, MAX_AGE_MS, parseRecording, spanMs } from '../../src/replay'
import { NOW, recording } from '../replay-fixture'

const URL_ = 'https://raw.example.test/replays/x.json'

function serve(body: string, status = 200) {
  return vi.fn(async () => new Response(body, { status }))
}

describe('replay recording validation', () => {
  it('accepts a well-formed recording and measures the real run', () => {
    const parsed = parseRecording(JSON.parse(JSON.stringify(recording())))
    expect(parsed).not.toBeNull()
    expect(spanMs(recording())).toBe(7000)
  })

  it.each([
    ['not an object', 'text'],
    ['an array', []],
    ['a null', null],
    ['another version', { ...recording(), version: 2 }],
    ['no exchanges', { ...recording(), exchanges: [] }],
    ['a bad date', { ...recording(), recorded_at: 'yesterday' }],
    ['no reported model', { ...recording(), reported: { ...recording().reported, model: '' } }],
    ['a negative cost', { ...recording(), reported: { ...recording().reported, cost_usd: -1 } }],
    ['a non-finite cost', { ...recording(), reported: { ...recording().reported, cost_usd: Number.NaN } }],
  ])('rejects %s', (_name, raw) => {
    expect(parseRecording(raw)).toBeNull()
  })

  it('rejects a recording of a run that errored, or any exchange that is not a same-origin /api call', () => {
    const base = recording()
    const withExchange = (change: Record<string, unknown>) => ({ ...base, exchanges: [{ ...base.exchanges[0], ...change }, base.exchanges[1]] })
    expect(parseRecording(withExchange({ status: 500 }))).toBeNull()
    expect(parseRecording(withExchange({ status: 204 }))).toBeNull()
    expect(parseRecording(withExchange({ path: 'https://elsewhere.test/api/x' }))).toBeNull()
    expect(parseRecording(withExchange({ path: '/other' }))).toBeNull()
    expect(parseRecording(withExchange({ request_body: 5 }))).toBeNull()
    expect(parseRecording(withExchange({ headers: { a: 1 } }))).toBeNull()
  })

  it('rejects times that do not run forwards', () => {
    const base = recording()
    const withExchange = (change: Record<string, unknown>) => ({ ...base, exchanges: [{ ...base.exchanges[0], ...change }, base.exchanges[1]] })
    expect(parseRecording(withExchange({ t_headers: 1 }))).toBeNull()
    expect(parseRecording(withExchange({ t_end: 3000 }))).toBeNull()
    expect(parseRecording(withExchange({ t_start: -1 }))).toBeNull()
    expect(parseRecording(withExchange({ chunks: [{ t: 4100, text: 'a' }, { t: 4000, text: 'b' }] }))).toBeNull()
    expect(parseRecording(withExchange({ chunks: [{ t: 9000, text: 'a' }] }))).toBeNull()
    expect(parseRecording(withExchange({ chunks: [{ t: 4000 }] }))).toBeNull()
  })
})

describe('replay staleness', () => {
  const at = (ageMs: number) => ({ ...recording(), recorded_at: new Date(NOW - ageMs).toISOString() })
  it('replays a recording up to three days old and no older', () => {
    expect(isStale(at(0), NOW)).toBe(false)
    expect(isStale(at(MAX_AGE_MS), NOW)).toBe(false)
    expect(isStale(at(MAX_AGE_MS + 1000), NOW)).toBe(true)
  })
  it('does not trust a recording dated in the future', () => {
    expect(isStale(at(-60_000), NOW)).toBe(false)
    expect(isStale(at(-3_600_000), NOW)).toBe(true)
  })
})

describe('loading the stored recording', () => {
  it('returns a fresh recording and asks for it without credentials or a referrer', async () => {
    const fetchImpl = serve(JSON.stringify(recording()))
    const result = await loadRecording(URL_, NOW, fetchImpl)
    expect(result.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(URL_)
    expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' })
  })

  it('says missing for a 404 or a lost connection, and never throws', async () => {
    expect(await loadRecording(URL_, NOW, serve('Not Found', 404))).toEqual({ ok: false, reason: 'missing' })
    const lost = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await loadRecording(URL_, NOW, lost)).toEqual({ ok: false, reason: 'missing' })
  })

  it('says malformed for text that is not JSON, a wrong shape, or an oversized body', async () => {
    expect(await loadRecording(URL_, NOW, serve('<html>'))).toEqual({ ok: false, reason: 'malformed' })
    expect(await loadRecording(URL_, NOW, serve('{"version":1}'))).toEqual({ ok: false, reason: 'malformed' })
    expect(await loadRecording(URL_, NOW, serve(' '.repeat(2_000_001)))).toEqual({ ok: false, reason: 'malformed' })
  })

  it('says stale for a recording older than three days', async () => {
    const old = { ...recording(), recorded_at: new Date(NOW - MAX_AGE_MS - 60_000).toISOString() }
    expect(await loadRecording(URL_, NOW, serve(JSON.stringify(old)))).toEqual({ ok: false, reason: 'stale' })
  })
})
