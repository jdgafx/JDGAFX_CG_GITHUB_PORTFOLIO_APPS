import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', async () => (await import('../helpers/hooks')).reactStub)

import { REPLAY_URL, useReplay } from '../../src/lib/useReplay'
import { render, resetHooks, unmount } from '../helpers/hooks'
import { analysisRecording, requestBody } from '../helpers/recording'

const realFetch = globalThis.fetch
const settle = () => new Promise(resolve => setTimeout(resolve, 5))

function page(search = '') {
  vi.stubGlobal('window', {
    location: { search, origin: 'http://localhost' },
    get fetch() {
      return globalThis.fetch
    },
  })
}

function stored(body: unknown, status = 200) {
  const fetchStub = vi.fn(async (url: string) => (url === REPLAY_URL ? new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }) : realFetch(url)))
  vi.stubGlobal('fetch', fetchStub)
  return fetchStub
}

function mount(idle: boolean) {
  const start = vi.fn()
  const clear = vi.fn()
  const view = () => render(() => useReplay({ idle, start, clear }))
  return { start, clear, view }
}

beforeEach(() => resetHooks())

afterEach(() => {
  unmount()
  vi.unstubAllGlobals()
  globalThis.fetch = realFetch
})

describe('the load-time replay', () => {
  it('starts the recorded picture from the empty screen, with the shim already in place', async () => {
    page()
    const fetchStub = stored(analysisRecording())
    const { start, view } = mount(true)
    view()
    await settle()
    const hook = view()
    expect(start).toHaveBeenCalledTimes(1)
    expect(start.mock.calls[0][0].file.type).toBe('image/jpeg')
    expect(globalThis.fetch).not.toBe(fetchStub)
    expect(hook.info?.recording.app).toBe('app-08-vision-ai')
    hook.stop()
  })

  it('plays nothing when the recording is missing, stale or malformed: today\'s empty screen stays', async () => {
    const stale = analysisRecording({ recorded_at: new Date(Date.now() - 4 * 86_400_000).toISOString() })
    for (const body of [stale, { version: 1 }, 'not json']) {
      resetHooks()
      page()
      stored(body)
      const { start, view } = mount(true)
      view()
      await settle()
      view()
      expect(start).not.toHaveBeenCalled()
    }
    resetHooks()
    page()
    stored('', 404)
    const missing = mount(true)
    missing.view()
    await settle()
    missing.view()
    expect(missing.start).not.toHaveBeenCalled()
  })

  it('plays nothing when the recording\'s request is not one the page can send again', async () => {
    page()
    const rec = analysisRecording()
    rec.exchanges[0].request_body = requestBody({ mode: 'qa', question: 'What?' })
    const fetchStub = stored(rec)
    const { start, view } = mount(true)
    view()
    await settle()
    view()
    expect(start).not.toHaveBeenCalled()
    expect(globalThis.fetch).toBe(fetchStub) // no shim was installed over the page's fetch
  })

  it('never starts over a visitor who got there first, even if the screen empties later', async () => {
    page()
    stored(analysisRecording())
    const { start, view } = mount(false)
    view()
    await settle()
    view()
    expect(start).not.toHaveBeenCalled()
    const later = render(() => useReplay({ idle: true, start, clear: vi.fn() }))
    await settle()
    expect(start).not.toHaveBeenCalled()
    later.stop()
  })

  it('is off with ?replay=off: the recording is not even fetched', async () => {
    page('?replay=off')
    const fetchStub = stored(analysisRecording())
    const { start, view } = mount(true)
    view()
    await settle()
    view()
    expect(fetchStub).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('clears the replayed run when the recording cannot answer the page\'s own call', async () => {
    page()
    const fetchStub = stored(analysisRecording())
    const { start, clear, view } = mount(true)
    view()
    await settle()
    view()
    expect(start).toHaveBeenCalled()
    // The page asks for something the recording never held.
    await expect(globalThis.fetch('/api/ai', { method: 'POST', body: requestBody({ image: 'AAAA' }) })).rejects.toThrow('Failed to fetch')
    expect(clear).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toBe(fetchStub)
  })
})
