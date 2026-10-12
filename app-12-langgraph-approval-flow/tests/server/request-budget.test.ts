import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLIENT_MARGIN_MS, PLATFORM_CUT_MS, PRE_STREAM_WORST_MS, REQUEST_WORST_MS } from '../../netlify/shared/budget'
import { CONNECT_TIMEOUT_MS, IDLE_TIMEOUT_MS, OVERALL_TIMEOUT_MS } from '../../src/lib/api'
import { providerFetch } from '../helpers/fake-openrouter'
import { untilSettled } from '../helpers/fake-time'
import { postJson } from '../helpers/http'
import { QUESTION } from '../helpers/issues'

// The Blobs stand-in. A test makes some calls hang, or take a fixed time, to see how long a request holds the visitor.
const shared = vi.hoisted(() => ({
  values: new Map<string, string>(),
  hangGet: [] as string[],
  hangSet: [] as string[],
  delayMs: 0,
}))

vi.mock('@netlify/blobs', () => {
  const never = () => new Promise<never>(() => {})
  const slow = async <T>(value: T): Promise<T> => {
    if (shared.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, shared.delayMs))
    return value
  }
  const hangs = (prefixes: string[], key: string) => prefixes.some((prefix) => key.startsWith(prefix))
  return {
    getStore: () => ({
      get: (key: string) => (hangs(shared.hangGet, key) ? never() : slow(shared.values.get(key) ?? null)),
      getWithMetadata: (key: string) => slow(shared.values.has(key) ? { data: shared.values.get(key) as string, etag: 'tag', metadata: {} } : null),
      set: (key: string, value: string, options: { onlyIfNew?: boolean } = {}) => {
        if (hangs(shared.hangSet, key)) return never()
        if (options.onlyIfNew && shared.values.has(key)) return slow({ modified: false })
        shared.values.set(key, value)
        return slow({ modified: true })
      },
      delete: (key: string) => {
        shared.values.delete(key)
        return slow(undefined)
      },
      list: (options: { prefix?: string }) => {
        const keys = [...shared.values.keys()].filter((key) => key.startsWith(options.prefix ?? ''))
        return (async function* pages() {
          yield { blobs: keys.map((key) => ({ key, etag: 'fake' })), directories: [] }
        })()
      },
    }),
  }
})

import resume from '../../netlify/functions/resume'
import retry from '../../netlify/functions/retry'
import start from '../../netlify/functions/start'
import { STORE_SLOW } from '../../netlify/shared/store'

const THREAD_ID = '019c6a1b-2c3d-7e8f-8b7a-1c2d3e4f5a6b'
let client = 1

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
  shared.values.clear()
  shared.hangGet = []
  shared.hangSet = []
  shared.delayMs = 0
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  process.env.OPENROUTER_API_KEY = ''
})

/** The time a request takes to settle, in fake milliseconds, and what it settled with. */
async function timed<T>(pending: Promise<T>): Promise<{ at: number; value: T }> {
  const began = Date.now()
  let at = -1
  const value = await untilSettled(pending.then((settled) => { at = Date.now() - began; return settled }))
  return { at, value }
}

describe('the page waits longer than the server can hold it', () => {
  it('waits for the answer to begin, for a whole request, and for a quiet stretch, each at least the server worst case plus 3 s', () => {
    expect(CONNECT_TIMEOUT_MS).toBeGreaterThanOrEqual(PRE_STREAM_WORST_MS + CLIENT_MARGIN_MS)
    expect(OVERALL_TIMEOUT_MS).toBeGreaterThanOrEqual(REQUEST_WORST_MS + CLIENT_MARGIN_MS)
    expect(IDLE_TIMEOUT_MS).toBeGreaterThanOrEqual(REQUEST_WORST_MS + CLIENT_MARGIN_MS)
  })

  it('never waits for a whole request longer than the platform lets the function run', () => {
    expect(OVERALL_TIMEOUT_MS).toBeLessThanOrEqual(PLATFORM_CUT_MS)
    expect(REQUEST_WORST_MS).toBeLessThan(PLATFORM_CUT_MS)
  })
})

describe('work before the stream opens ends before the page stops waiting', () => {
  const resumeRequest = () => postJson('/api/resume', { threadId: THREAD_ID, decision: { action: 'approve' } }, `ip-pre-${client++}`)
  const retryRequest = () => postJson('/api/retry', { threadId: THREAD_ID }, `ip-pre-${client++}`)
  const startRequest = () => postJson('/api/start', { issue: QUESTION }, `ip-pre-${client++}`)

  it.each([
    ['start', () => start(startRequest())],
    ['resume', () => resume(resumeRequest())],
    ['retry', () => retry(retryRequest())],
  ])('answers %s with the store message when every store call hangs', async (_name, call) => {
    shared.hangGet = ['']
    shared.hangSet = ['']
    const { at, value } = await timed(call())
    expect(value.status).toBe(503)
    expect(await value.json()).toEqual({ success: false, error: STORE_SLOW })
    expect(at + CLIENT_MARGIN_MS).toBeLessThanOrEqual(CONNECT_TIMEOUT_MS)
  })

  it.each([
    ['start', () => start(startRequest())],
    ['resume', () => resume(resumeRequest())],
    ['retry', () => retry(retryRequest())],
  ])('answers %s before the page gives up when every store call takes just under the call limit', async (_name, call) => {
    shared.delayMs = 7_900
    const { at, value } = await timed(call())
    expect(value.status).toBe(503)
    expect(at + CLIENT_MARGIN_MS).toBeLessThanOrEqual(CONNECT_TIMEOUT_MS)
  })

  it.each([
    ['resume', () => resume(resumeRequest())],
    ['retry', () => retry(retryRequest())],
  ])('also bounds the claim release of a refused %s request', async (_name, call) => {
    // The claim is taken at once, then the checkpoint read hangs, and so does the read that the release makes.
    shared.hangGet = ['thread/', 'threads/', 'claims/']
    const { at, value } = await timed(call())
    expect(value.status).toBe(503)
    expect(at).toBeLessThanOrEqual(PRE_STREAM_WORST_MS)
    expect(at + CLIENT_MARGIN_MS).toBeLessThanOrEqual(CONNECT_TIMEOUT_MS)
  })
})

describe('the closing writes end with the request budget', () => {
  it('ends a failed run, its summary write and its claim release inside the worst case the page waits for', async () => {
    vi.stubGlobal('fetch', providerFetch({ status: 401 }))
    // The run fails at once. Then the summary write and the claim release both hang.
    shared.hangSet = ['threads/', 'updated/', 'waiting/']
    shared.hangGet = ['claims/']
    const response = await start(postJson('/api/start', { issue: QUESTION }, `ip-close-${client++}`))
    expect(response.status).toBe(200)
    const { at, value } = await timed(response.text())
    expect(value).toContain('[DONE]')
    expect(value).toContain('"type":"error"')
    expect(at).toBeLessThanOrEqual(REQUEST_WORST_MS)
    expect(at + CLIENT_MARGIN_MS).toBeLessThanOrEqual(OVERALL_TIMEOUT_MS)
  })
})
