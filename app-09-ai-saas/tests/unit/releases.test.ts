import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyVersion, fetchReleases, parseReleases, releasesUrl, ReleaseError } from '../../src/lib/releases'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('classifyVersion', () => {
  it('reads the step from the number', () => {
    expect(classifyVersion('4.0.0')).toBe('major')
    expect(classifyVersion('4.2.0')).toBe('minor')
    expect(classifyVersion('4.2.7')).toBe('patch')
    expect(classifyVersion('1.0.0')).toBe('major')
    expect(classifyVersion('1.0.1')).toBe('patch')
  })

  it('treats the second number as the big step below 1.0.0', () => {
    expect(classifyVersion('0.5.0')).toBe('minor')
    expect(classifyVersion('0.5.2')).toBe('patch')
    expect(classifyVersion('0.0.3')).toBe('patch')
  })

  it('leaves out prereleases, builds and anything that is not x.y.z', () => {
    expect(classifyVersion('4.0.0-beta.1')).toBeNull()
    expect(classifyVersion('4.5.0-canary.20260828T171753')).toBeNull()
    expect(classifyVersion('4.0')).toBeNull()
    expect(classifyVersion('0.0.0')).toBeNull()
  })
})

describe('parseReleases', () => {
  // The shape of the registry's `time` map: created and modified are not versions.
  const doc = {
    name: 'zod',
    time: {
      created: '2020-03-07T01:00:00.000Z',
      modified: '2026-10-02T16:52:46.000Z',
      '3.25.0': '2025-05-14T09:00:00.000Z',
      '4.0.0': '2025-07-08T12:30:00.000Z',
      '4.0.1-beta.0': '2025-06-01T00:00:00.000Z',
      '4.1.0': 'not a date',
      '4.0.2': '2025-07-09T23:59:59.000Z',
    },
  }

  it('lists stable releases with their UTC day, oldest first', () => {
    expect(parseReleases(doc)).toEqual([
      { version: '3.25.0', date: '2025-05-14', kind: 'minor' },
      { version: '4.0.0', date: '2025-07-08', kind: 'major' },
      { version: '4.0.2', date: '2025-07-09', kind: 'patch' },
    ])
  })

  it('rejects a document with no time map instead of reporting an empty history', () => {
    expect(() => parseReleases({ name: 'zod' })).toThrow(ReleaseError)
    expect(() => parseReleases(null)).toThrow(ReleaseError)
    expect(() => parseReleases({ time: [] })).toThrow(ReleaseError)
  })
})

describe('fetchReleases (through the releases service)', () => {
  const stub = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
    const mock = vi.fn(impl)
    vi.stubGlobal('fetch', mock)
    return mock
  }

  it('builds the service URL with a scoped name encoded', () => {
    expect(releasesUrl('react')).toBe('/api/releases?name=react')
    expect(releasesUrl('@anthropic-ai/sdk')).toBe('/api/releases?name=%40anthropic-ai%2Fsdk')
  })

  it('reads releases from a 200', async () => {
    const mock = stub(async () => Response.json({ time: { created: '2020-01-01T00:00:00.000Z', '1.2.3': '2024-02-03T04:05:06.000Z' } }))
    await expect(fetchReleases('left-pad')).resolves.toEqual([{ version: '1.2.3', date: '2024-02-03', kind: 'patch' }])
    expect(mock.mock.calls[0][0]).toBe('/api/releases?name=left-pad')
  })

  it('passes on the service\'s own message and kind, including "too large", exactly', async () => {
    stub(async () => Response.json({ error: 'The registry record is larger than the 250 MB this service reads.', kind: 'too-large' }, { status: 413 }))
    await expect(fetchReleases('huge')).rejects.toMatchObject({ kind: 'too-large', message: 'The registry record is larger than the 250 MB this service reads.' })
  })

  it('names an HTTP error with no body, a dropped connection and unreadable JSON in plain words', async () => {
    stub(async () => new Response('x', { status: 503 }))
    await expect(fetchReleases('a')).rejects.toMatchObject({ kind: 'unexpected', message: expect.stringContaining('HTTP 503') })
    stub(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(fetchReleases('a')).rejects.toMatchObject({ kind: 'network' })
    stub(async () => new Response('<html>'))
    await expect(fetchReleases('a')).rejects.toMatchObject({ kind: 'unexpected' })
  })

  it('rethrows the callers own abort', async () => {
    stub((_url, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))))
    const own = new AbortController()
    const pending = fetchReleases('slow', own.signal)
    own.abort(new DOMException('stopped', 'AbortError'))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
