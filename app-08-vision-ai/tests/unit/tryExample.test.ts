import { describe, expect, it } from 'vitest'
import type { CommonsImage } from '../../src/lib/commons'
import { liveIndicator } from '../../src/lib/liveData'
import { loadTryExample, type TryDeps } from '../../src/lib/tryExample'

const IMAGE: CommonsImage = {
  title: 'Street scene',
  fileName: 'Street_scene.jpg',
  pageUrl: 'https://commons.wikimedia.org/wiki/File:Street_scene.jpg',
  thumbUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f5/Street_scene.jpg/1280px-Street_scene.jpg',
  mime: 'image/jpeg',
  width: 1280,
  height: 1900,
  author: 'Author not stated',
  licence: 'CC BY 4.0',
  licenceUrl: null,
}
const FILE = new File(['x'], 'Street_scene.jpg', { type: 'image/jpeg' })
const BLOCKED = new TypeError('fetch failed')

const working: TryDeps = { search: async () => [IMAGE], download: async () => FILE }

// What the masthead chip shows for a pick that has no picture loaded yet.
function chipAfter(commonsFailed: boolean): string {
  return liveIndicator({ loaded: [], at: null, commonsFailed }).label
}

describe('Try it with Commons', () => {
  it('shows the unavailable chip when the search fails, and says so in the error', async () => {
    const outcome = await loadTryExample('street', { search: () => Promise.reject(BLOCKED), download: async () => FILE })

    expect(outcome).toMatchObject({ status: 'failed', commonsFailed: true, message: 'fetch failed' })
    expect(chipAfter(outcome.commonsFailed)).toBe('Live data unavailable: Wikimedia Commons')
  })

  it('shows the unavailable chip when the download fails', async () => {
    const outcome = await loadTryExample('street', { search: async () => [IMAGE], download: () => Promise.reject(BLOCKED) })

    expect(outcome.commonsFailed).toBe(true)
    expect(chipAfter(outcome.commonsFailed)).toBe('Live data unavailable: Wikimedia Commons')
  })

  it('clears the unavailable chip on a later success', async () => {
    const failed = await loadTryExample('street', { search: () => Promise.reject(BLOCKED), download: async () => FILE })
    expect(chipAfter(failed.commonsFailed)).toBe('Live data unavailable: Wikimedia Commons')

    const loaded = await loadTryExample('street', working)

    expect(loaded).toMatchObject({ status: 'loaded', commonsFailed: false, file: FILE, image: IMAGE })
    expect(liveIndicator({ loaded: [IMAGE], at: 0, commonsFailed: loaded.commonsFailed })).toMatchObject({ state: 'live' })
  })

  it('does not call an empty search a Commons failure', async () => {
    const outcome = await loadTryExample('street', { search: async () => [], download: async () => FILE })

    expect(outcome).toMatchObject({
      status: 'failed',
      commonsFailed: false,
      message: 'Wikimedia Commons found no usable picture for the example. Try again.',
    })
  })
})
