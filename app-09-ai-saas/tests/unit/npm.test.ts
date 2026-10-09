import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDownloads, loadDownloads, NpmError, parseRange, rangeUrl, requestRange } from '../../src/lib/npm'

/** The shape api.npmjs.org returns for one package, recorded 2026-10-09 and trimmed to four days. Used in tests only. */
const RECORDED_REPLY = {
  start: '2026-10-04',
  end: '2026-10-07',
  package: 'react',
  downloads: [
    { downloads: 21_478_058, day: '2026-10-04' },
    { downloads: 35_446_968, day: '2026-10-05' },
    { downloads: 0, day: '2026-10-06' },
    { downloads: 35_968_597, day: '2026-10-07' },
  ],
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('rangeUrl', () => {
  it('builds the single-package range endpoint', () => {
    expect(rangeUrl('react', '2026-09-08', '2026-10-09')).toBe('https://api.npmjs.org/downloads/range/2026-09-08:2026-10-09/react')
  })

  it('encodes a scoped name into one path segment', () => {
    expect(rangeUrl('@angular/core', '2026-09-08', '2026-10-09')).toBe(
      'https://api.npmjs.org/downloads/range/2026-09-08:2026-10-09/%40angular%2Fcore',
    )
  })
})

describe('requestRange', () => {
  it('reaches back the window plus a week of allowance, ending today', () => {
    expect(requestRange(30, '2026-10-09')).toEqual({ start: '2026-09-03', end: '2026-10-09' })
    expect(requestRange(365, '2026-10-09')).toEqual({ start: '2025-10-03', end: '2026-10-09' })
  })
})

describe('parseRange', () => {
  it('reads the recorded reply into days, oldest first', () => {
    expect(parseRange(RECORDED_REPLY)).toEqual([
      { day: '2026-10-04', downloads: 21_478_058 },
      { day: '2026-10-05', downloads: 35_446_968 },
      { day: '2026-10-06', downloads: 0 },
      { day: '2026-10-07', downloads: 35_968_597 },
    ])
  })

  it('sorts days that arrive out of order', () => {
    const days = parseRange({ downloads: [{ day: '2026-10-05', downloads: 2 }, { day: '2026-10-04', downloads: 1 }] })
    expect(days.map((d) => d.day)).toEqual(['2026-10-04', '2026-10-05'])
  })

  it('accepts an empty list', () => {
    expect(parseRange({ downloads: [] })).toEqual([])
  })

  it('rejects anything that is not the documented shape', () => {
    for (const bad of [null, 'text', {}, { downloads: 'x' }, { downloads: [{ day: '2026-10-04' }] }, { downloads: [{ day: 'yesterday', downloads: 1 }] }, { downloads: [{ day: '2026-10-04', downloads: -1 }] }, { downloads: [null] }]) {
      expect(() => parseRange(bad)).toThrow(NpmError)
    }
  })
})

describe('fetchDownloads', () => {
  it('returns the parsed days for a 200', async () => {
    const mock = vi.fn(async () => reply(200, RECORDED_REPLY))
    vi.stubGlobal('fetch', mock)
    expect(await fetchDownloads('react', '2026-10-04', '2026-10-07')).toHaveLength(4)
    expect(mock).toHaveBeenCalledWith('https://api.npmjs.org/downloads/range/2026-10-04:2026-10-07/react', expect.anything())
  })

  it.each([
    [404, 'not-found', '"nope" is not on npm. Check the spelling.'],
    [429, 'rate-limit', 'npm is limiting requests right now. Wait a minute, then retry.'],
    [503, 'unexpected', 'npm answered with an error (HTTP 503). Retry in a moment.'],
  ])('maps HTTP %i to a plain message', async (status, kind, message) => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(status, { error: 'x' })))
    await expect(fetchDownloads('nope', '2026-10-04', '2026-10-07')).rejects.toMatchObject({ name: 'NpmError', kind, message })
  })

  it('reports a dropped connection as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(fetchDownloads('react', '2026-10-04', '2026-10-07')).rejects.toMatchObject({
      kind: 'network',
      message: 'Could not reach npm. Check your connection, then retry.',
    })
  })

  it('reports an unreadable body as unexpected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })))
    await expect(fetchDownloads('react', '2026-10-04', '2026-10-07')).rejects.toMatchObject({ kind: 'unexpected' })
  })

  it('reports a request that outlives its time limit as a timeout', async () => {
    // Node runs AbortSignal.timeout on an internal timer that fake timers do not reach, so the signal is driven by hand.
    const limit = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(limit.signal)
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })))
    const settled = fetchDownloads('react', '2026-10-04', '2026-10-07').catch((err: unknown) => err)
    limit.abort(new DOMException('The operation timed out.', 'TimeoutError'))
    expect(await settled).toMatchObject({ kind: 'timeout', message: 'npm did not answer within 10 seconds. Retry.' })
  })

  it("rethrows the caller's own abort instead of calling it a network error", async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })))
    const settled = fetchDownloads('react', '2026-10-04', '2026-10-07', controller.signal).catch((err: unknown) => err)
    controller.abort()
    expect(await settled).not.toBeInstanceOf(NpmError)
  })
})

describe('loadDownloads', () => {
  it('makes one request per package, scoped names included, and keeps a failure beside the successes', async () => {
    const mock = vi.fn(async (url: string) => {
      if (url.endsWith('/missing-pkg')) return reply(404, { error: 'package missing-pkg not found' })
      return reply(200, RECORDED_REPLY)
    })
    vi.stubGlobal('fetch', mock)

    const outcomes = await loadDownloads(['react', '@angular/core', 'missing-pkg'], 30, '2026-10-09')

    expect(mock.mock.calls.map((c) => c[0])).toEqual([
      'https://api.npmjs.org/downloads/range/2026-09-03:2026-10-09/react',
      'https://api.npmjs.org/downloads/range/2026-09-03:2026-10-09/%40angular%2Fcore',
      'https://api.npmjs.org/downloads/range/2026-09-03:2026-10-09/missing-pkg',
    ])
    expect(outcomes.map((o) => o.name)).toEqual(['react', '@angular/core', 'missing-pkg'])
    expect('days' in outcomes[0] && outcomes[0].days).toHaveLength(4)
    const failed = outcomes[2]
    expect('error' in failed && failed.error.kind).toBe('not-found')
  })

  it('refuses an empty list, too many packages, or an invalid name before any request', async () => {
    const mock = vi.fn()
    vi.stubGlobal('fetch', mock)
    await expect(loadDownloads([], 30, '2026-10-09')).rejects.toThrow(RangeError)
    await expect(loadDownloads(['a', 'b', 'c', 'd', 'e', 'f'], 30, '2026-10-09')).rejects.toThrow(RangeError)
    await expect(loadDownloads(['Not Valid'], 30, '2026-10-09')).rejects.toThrow(RangeError)
    expect(mock).not.toHaveBeenCalled()
  })
})
