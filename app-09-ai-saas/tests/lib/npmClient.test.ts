import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, fetchRange, fetchReleases, isPackageName, rangeUrl, todayUtc } from '../../src/lib/npmClient'
import { NPM_BODY, RELEASES, jsonResponse } from '../ui/helpers'

describe('npmClient', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('asks for RUN_DATE-371 to RUN_DATE and encodes a scoped name as @scope%2Fname', () => {
    expect(rangeUrl('vite', '2026-10-12')).toBe('https://api.npmjs.org/downloads/range/2025-10-06:2026-10-12/vite')
    expect(rangeUrl('@anthropic-ai/sdk', '2026-10-12')).toBe(
      'https://api.npmjs.org/downloads/range/2025-10-06:2026-10-12/@anthropic-ai%2Fsdk',
    )
  })

  it('computes UTC days', () => {
    expect(todayUtc(new Date('2026-10-12T23:59:59-05:00'))).toBe('2026-10-13')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('sends every request with cache no-store, so 2 runs make 2 requests', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(NPM_BODY.vite))
    await fetchRange('vite', '2026-10-12')
    await fetchRange('vite', '2026-10-12')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of fetchMock.mock.calls) expect(call[1]?.cache).toBe('no-store')
  })

  it('turns the captured range response into rows keyed by day', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(NPM_BODY.vite))
    const result = await fetchRange('vite', '2026-10-12')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(Object.keys(result.rows)).toHaveLength(372)
    expect(result.rows['2025-10-06']).toBe(6397763)
  })

  it('reports not-found, a bad body and a network error as failed', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'package nope not found' }, { status: 404 }))
    expect(await fetchRange('nope', '2026-10-12')).toEqual({ name: 'nope', status: 'failed', reason: 'not-found' })
    fetchMock.mockResolvedValueOnce(jsonResponse({ downloads: [{ day: 'x', downloads: -1 }] }))
    expect((await fetchRange('vite', '2026-10-12')).status).toBe('failed')
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }))
    expect((await fetchRange('vite', '2026-10-12')).status).toBe('failed')
    fetchMock.mockRejectedValueOnce(new TypeError('network'))
    expect(await fetchRange('vite', '2026-10-12')).toEqual({ name: 'vite', status: 'failed', reason: 'network' })
  })

  it('aborts after 10 seconds', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const pending = fetchRange('vite', '2026-10-12')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await pending).toEqual({ name: 'vite', status: 'failed', reason: 'timeout' })
  })

  it('validates package names at the boundary', () => {
    for (const ok of ['react', 'drizzle-orm', '@anthropic-ai/sdk', 'd3', 'lodash.merge']) expect(isPackageName(ok)).toBe(true)
    for (const bad of ['', ' ', 'Has Space', 'a/b', '../x', '@scope', 'UPPER', 'x'.repeat(215), 'a?b', '~x', '-x', '@~s/x', '@-s/x']) expect(isPackageName(bad)).toBe(false)
  })

  it('reads releases from /api/releases?name= and treats anything else as failed', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'vite', status: 'ok', releases: RELEASES.vite }))
    const ok = await fetchReleases('vite')
    expect(ok).toEqual({ name: 'vite', status: 'ok', releases: RELEASES.vite })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/releases?name=vite')
    fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'vite', status: 'failed', releases: [] }))
    expect((await fetchReleases('vite')).status).toBe('failed')
    // the SPA fallback answers 200 with the HTML page when the function is absent
    fetchMock.mockResolvedValueOnce(new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    expect(await fetchReleases('vite')).toEqual({ name: 'vite', status: 'failed', releases: [] })
    fetchMock.mockRejectedValueOnce(new TypeError('network'))
    expect((await fetchReleases('@anthropic-ai/sdk')).status).toBe('failed')
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/releases?name=%40anthropic-ai%2Fsdk')
  })
})
