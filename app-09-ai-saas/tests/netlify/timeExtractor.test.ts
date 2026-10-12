import { describe, expect, it } from 'vitest'
import { readTime } from '../../netlify/shared/timeExtractor'

/** A body delivered in chunks of `size` bytes, so tokens straddle chunk boundaries. */
function stream(text: string, size = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  let at = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) return controller.close()
      controller.enqueue(bytes.slice(at, at + size))
      at += size
    },
  })
}

const TIME = { created: '2015-01-01T00:00:00.000Z', '1.0.0': '2020-01-01T00:00:00.000Z', '1.1.0-beta.1': '2021-01-01T00:00:00.000Z' }

describe('readTime', () => {
  it('reads the top-level time object, whatever the chunk size', async () => {
    const doc = JSON.stringify({ name: 'x', versions: { '1.0.0': { a: 1 } }, time: TIME, readme: 'text' })
    for (const size of [1, 3, 7, 1000]) expect(await readTime(stream(doc, size), 1e6), String(size)).toEqual(TIME)
  })
  it('ignores a "time" key nested deeper, and "time" inside strings', async () => {
    const doc = JSON.stringify({
      versions: { '1.0.0': { time: { fake: 'x' }, description: 'has "time": {"a":1} in it, and a } brace \\ and \\" quote' } },
      readme: '{"time":{"fake":"y"}}',
      time: TIME,
    })
    expect(await readTime(stream(doc), 1e6)).toEqual(TIME)
  })
  it('reads a time object that holds braces and quotes inside strings', async () => {
    const tricky = { '1.0.0': '2020-01-01T00:00:00.000Z', 'odd}"key{': 'v"}{' }
    expect(await readTime(stream(JSON.stringify({ time: tricky, z: 1 }), 5), 1e6)).toEqual(tricky)
  })
  it('gives null when there is no time, or it is not an object', async () => {
    expect(await readTime(stream(JSON.stringify({ name: 'x' })), 1e6)).toBeNull()
    expect(await readTime(stream(JSON.stringify({ time: 'soon' })), 1e6)).toBeNull()
    expect(await readTime(stream(JSON.stringify({ time: [1, 2] })), 1e6)).toBeNull()
    expect(await readTime(stream('[1,2,3]'), 1e6)).toBeNull()
  })
  it('throws on a body over the byte cap, and on a cut-off document', async () => {
    await expect(readTime(stream(JSON.stringify({ pad: 'x'.repeat(500), time: TIME })), 100)).rejects.toThrow()
    await expect(readTime(stream('{"name":"x","time":{"created":"2015'), 1e6)).rejects.toThrow()
  })
  it('stops reading once the time object is complete', async () => {
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(new TextEncoder().encode(pulls === 1 ? `{"time":${JSON.stringify(TIME)},"rest":"` : 'y'.repeat(1000)))
        if (pulls > 50) controller.close()
      },
    })
    expect(await readTime(body, 1e9)).toEqual(TIME)
    expect(pulls).toBeLessThan(5)
  })
})
