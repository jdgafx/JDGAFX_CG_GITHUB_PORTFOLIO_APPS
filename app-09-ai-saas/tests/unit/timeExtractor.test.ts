import { afterEach, describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/releases'
import { readTime, TimeExtractor, TooLargeError } from '../../netlify/shared/timeExtractor'
import { PRESETS } from '../../src/lib/presets'
import { parseReleases } from '../../src/lib/releases'

afterEach(() => vi.unstubAllGlobals())

const doc = (versionsFirst = true) => {
  const versions = { '1.0.0': { name: 'x', dist: { tarball: 'https://a/{"time":{}}' }, description: 'has "time": { in it }' }, '1.1.0': { name: 'x' } }
  const time = { created: '2020-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', '1.0.0': '2020-01-02T00:00:00.000Z', '1.1.0': '2021-01-02T00:00:00.000Z' }
  return JSON.stringify(versionsFirst ? { name: 'x', 'dist-tags': { latest: '1.1.0' }, versions, time, readme: 'text' } : { name: 'x', time, versions })
}

describe('TimeExtractor', () => {
  it('returns the top-level time object, not one that sits inside a version', () => {
    const extractor = new TimeExtractor()
    extractor.push(doc())
    expect(extractor.done).toBe(true)
    expect(extractor.result()).toMatchObject({ '1.0.0': '2020-01-02T00:00:00.000Z', '1.1.0': '2021-01-02T00:00:00.000Z' })
  })

  it('reads the same result at every chunk size, including splits inside strings and escapes', () => {
    const text = doc().replace('has ', 'has \\"quoted\\" and \\\\ ')
    const whole = new TimeExtractor()
    whole.push(text)
    for (const size of [1, 2, 3, 7, 64]) {
      const extractor = new TimeExtractor()
      for (let i = 0; i < text.length; i += size) extractor.push(text.slice(i, i + size))
      expect(extractor.result(), `chunks of ${size}`).toEqual(whole.result())
    }
  })

  it('finds time before or after versions, and gives null when there is none', () => {
    const early = new TimeExtractor()
    early.push(doc(false))
    expect(early.result()).not.toBeNull()
    const none = new TimeExtractor()
    none.push('{"name":"x","versions":{"1.0.0":{}}}')
    expect(none.result()).toBeNull()
  })

  it('feeds the release parser', () => {
    const extractor = new TimeExtractor()
    extractor.push(doc())
    expect(parseReleases({ time: extractor.result() }).map((r) => r.version)).toEqual(['1.0.0', '1.1.0'])
  })
})

describe('readTime', () => {
  const stream = (chunks: Uint8Array[]) => new ReadableStream<Uint8Array>({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close() } })

  it('streams a document far larger than what it keeps, and stops after the time object', async () => {
    const encoder = new TextEncoder()
    const filler = encoder.encode(`"v${'x'.repeat(1000)}":1,`)
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode('{"versions":{'))
      },
      pull(c) {
        if (sent < 70_000) {
          sent += 1
          c.enqueue(filler) // about 70 MB of versions
        } else {
          c.enqueue(encoder.encode('"z":0},"time":{"1.0.0":"2020-01-02T00:00:00.000Z"},"readme":"'))
          for (let i = 0; i < 10; i++) c.enqueue(filler)
          c.close()
        }
      },
    })
    const time = await readTime(body, 250_000_000)
    expect(time).toEqual({ '1.0.0': '2020-01-02T00:00:00.000Z' })
  })

  it('throws TooLargeError past the cap', async () => {
    await expect(readTime(stream([new Uint8Array(600), new Uint8Array(600)]), 1000)).rejects.toBeInstanceOf(TooLargeError)
  })
})

describe('the releases function', () => {
  const call = (name: string | null) => handler(new Request(`https://site.example/api/releases${name === null ? '' : `?name=${encodeURIComponent(name)}`}`))

  it('answers with the release dates only, from the fixed registry host, for a scoped name too', async () => {
    const mock = vi.fn((url: string) => (void url, Promise.resolve(new Response(doc()))))
    vi.stubGlobal('fetch', mock)
    const res = await call('@scope/pkg')
    expect(mock.mock.calls[0][0]).toBe('https://registry.npmjs.org/%40scope%2Fpkg')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ time: expect.objectContaining({ '1.0.0': '2020-01-02T00:00:00.000Z' }) })
  })

  it('refuses an invalid name, a wrong method and a record with no dates, and names a 404, a bad status and a timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 404 })))
    expect((await call('Not Valid')).status).toBe(400)
    expect((await call(null)).status).toBe(400)
    expect((await handler(new Request('https://site.example/api/releases?name=a', { method: 'POST' }))).status).toBe(405)
    expect(await (await call('a')).json()).toMatchObject({ kind: 'not-found' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 503 })))
    expect(await (await call('a')).json()).toMatchObject({ kind: 'unexpected' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"name":"a"}')))
    expect((await call('a')).status).toBe(502)
  })

  it('says exactly when a record is too large', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(60_000_000)) } }))))
    const res = await call('huge')
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'The registry record is larger than the 250 MB this service reads.', kind: 'too-large' })
  }, 30_000)
})

// Reads every preset's packages through the real function and the real registry. Network, so run with LIVE_REGISTRY=1.
describe.skipIf(!process.env.LIVE_REGISTRY)('every preset package is readable (live registry)', () => {
  const names = [...new Set(PRESETS.flatMap((preset) => preset.names))]
  it.each(names)('%s', async (name) => {
    const res = await handler(new Request(`https://site.example/api/releases?name=${encodeURIComponent(name)}`))
    expect(res.status, name).toBe(200)
    expect(parseReleases(await res.json()).length).toBeGreaterThan(0)
  }, 60_000)
})
