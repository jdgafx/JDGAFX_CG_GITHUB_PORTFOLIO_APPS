import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExplainReply } from '../../shared/types'
import App from '../../src/App'
import { recordedCost, recordedRunDate, requestMatches, REPLAY_URL } from '../../src/lib/useReplay'
import { TRY_IT, type RunDeps } from '../../src/lib/useRun'
import type { Recording } from '../../src/replay'
import { byText, cleanup, click, explainFromCapture, flush, jsonResponse, mount } from './helpers'
import { makeStubCore } from './stubCore'
import r1aReact from './fixtures/response-r1a-react.json'
import r1aVite from './fixtures/response-r1a-vite.json'
import r1aZod from './fixtures/response-r1a-zod.json'
import r1aSdk from './fixtures/response-r1a-anthropic-ai2Fsdk.json'

const CAPTURES: Record<string, unknown> = { react: r1aReact, vite: r1aVite, zod: r1aZod, '@anthropic-ai/sdk': r1aSdk }
const RECORDED_DAY = '2026-10-10'
const reply = (name: string): ExplainReply => ({ ...explainFromCapture(CAPTURES[name]), newestModel: 'anthropic/claude-haiku-5.5', costUsd: 0.0016 })

function ask(target: string, over: { days?: number; runDate?: string } = {}): string {
  const names = [target, ...TRY_IT.names.filter(n => n !== target)]
  return JSON.stringify({ target, names, window: { days: over.days ?? TRY_IT.days, runDate: over.runDate ?? RECORDED_DAY } })
}

function recording(over: Partial<Recording> = {}, ageMs = 2 * 3_600_000): Recording {
  const exchanges: Recording['exchanges'] = []
  TRY_IT.names.forEach((name, i) => {
    const body = JSON.stringify({ status: 'ok', releases: [] })
    exchanges.push({ method: 'GET', path: `/api/releases?name=${encodeURIComponent(name)}`, request_body: null, status: 200, headers: { 'content-type': 'application/json' }, t_start: 0, t_headers: 5, t_end: 8, chunks: [{ t: 8, text: body }] })
    const text = JSON.stringify(reply(name))
    exchanges.push({ method: 'POST', path: '/api/explain', request_body: ask(name), status: 200, headers: { 'content-type': 'application/json' }, t_start: 10, t_headers: 40 + i, t_end: 50 + i, chunks: [{ t: 50 + i, text }] })
  })
  return {
    version: 1,
    app: 'app-09-ai-saas',
    url: 'https://example.test/',
    recorded_at: new Date(Date.now() - ageMs).toISOString(),
    reported: { model: 'anthropic/claude-haiku-5.5', model_role: 'explained by', cost_usd: 0.0016, cost_scope: 'one explanation call' },
    exchanges,
    ...over,
  }
}

describe('recording checks', () => {
  it('finds the run day only in a recording of the very Try it comparison', () => {
    expect(recordedRunDate(recording())).toBe(RECORDED_DAY)
    const wrongDays = recording()
    wrongDays.exchanges[1]!.request_body = ask('react', { days: 30 })
    expect(recordedRunDate(wrongDays)).toBeNull()
    const split = recording()
    split.exchanges[3]!.request_body = ask('vite', { runDate: '2026-10-09' })
    expect(recordedRunDate(split)).toBeNull()
    const fewer = recording()
    fewer.exchanges = fewer.exchanges.filter(e => !(e.path === '/api/explain' && e.request_body?.includes('"target":"zod"')))
    expect(recordedRunDate(fewer)).toBeNull()
    const badDay = recording()
    for (const e of badDay.exchanges) if (e.request_body) e.request_body = e.request_body.replace(RECORDED_DAY, 'yesterday')
    expect(recordedRunDate(badDay)).toBeNull()
  })

  it('counts the recorded cost like the readout: every call, unreported ones named', () => {
    expect(recordedCost(recording())).toEqual({ cost: expect.closeTo(0.0064, 6), unreported: 0 })
    const one = recording()
    one.exchanges[1]!.chunks = [{ t: 50, text: JSON.stringify({ ...reply('react'), costUsd: null }) }]
    expect(recordedCost(one)).toEqual({ cost: expect.closeTo(0.0048, 6), unreported: 1 })
  })

  it('matches an explain request on package, packages, window and day, not on the figures inside it', () => {
    const recorded = ask('react')
    expect(requestMatches(recorded, recorded.replace('"window"', '"facts":[{"x":1}],"window"'), '/api/explain')).toBe(true)
    expect(requestMatches(recorded, ask('vite'), '/api/explain')).toBe(false)
    expect(requestMatches(recorded, ask('react', { runDate: '2026-10-11' }), '/api/explain')).toBe(false)
    expect(requestMatches(null, null, '/api/releases?name=react')).toBe(true)
    expect(requestMatches(null, 'x', '/api/releases?name=react')).toBe(false)
  })
})

describe('App replay on load', () => {
  let api: Array<{ method: string; path: string }>
  let served: Response | null

  beforeEach(() => {
    api = []
    served = null
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // The page's fetch before any replay: the recording URL, and a live /api/* that the test counts.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost/')
        if (url.href === REPLAY_URL) return served ?? new Response('', { status: 404 })
        api.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname + url.search })
        if (url.pathname === '/api/releases') return jsonResponse({ status: 'ok', releases: [] })
        const target = (JSON.parse(String(init?.body)) as { target: string }).target
        return jsonResponse(reply(target))
      }),
    )
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  function deps(over: Partial<RunDeps> = {}): { deps: Partial<RunDeps>; days: string[] } {
    const days: string[] = []
    return {
      days,
      deps: {
        core: makeStubCore(),
        today: () => '2026-10-13',
        fetchRange: async (name, runDate) => (days.push(runDate), { name, status: 'ok', rows: {} }),
        ...over,
      },
    }
  }
  /** Only the free release-history reads of the live view may reach the server; no explanation request, which would be a model call. */
  const onlyFreeReads = () => api.every(a => a.method === 'GET' && a.path.startsWith('/api/releases?'))
  const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

  it('plays a fresh recording through the page itself, labelled, for the recorded day, and sends nothing', async () => {
    served = jsonResponse(recording())
    const d = deps()
    const { container } = mount(<App deps={d.deps} />)
    await flush(10)
    await wait(300)
    await flush(10)
    const label = container.querySelector('[data-replay-label]')
    expect(label?.querySelector('strong')?.textContent).toBe('Replay of a real run')
    expect(label?.querySelector('[data-replay-age]')?.textContent).toBe('2 h ago')
    expect(label?.querySelector('[data-replay-model]')?.textContent).toBe('explained by claude-haiku-5.5')
    expect(label?.querySelector('[data-replay-model]')?.getAttribute('title')).toBe('anthropic/claude-haiku-5.5')
    expect(label?.querySelector('[data-replay-cost]')?.textContent).toBe('cost $0.0064')
    expect(container.querySelectorAll('section.explanation article')).toHaveLength(4)
    expect(container.querySelector('.ds-app')?.getAttribute('data-run')).toBe('done')
    // the label carries the model and cost, so the readout tiles (which would count the sped-up replay) are not shown
    expect(container.querySelector('.ds-run__readout')).toBeNull()
    expect(container.querySelector('[data-live-label]')).toBeNull()
    // the figure check is a summary line with the table folded away until asked for
    expect(container.querySelector('details.figure-check__rows')?.hasAttribute('open')).toBe(false)
    // inline, a claim is its mark only; its name is in the tooltip
    expect(container.querySelector('.claim-label')).toBeNull()
    // the live view of the load was drawn for today, the replay for the recorded day
    expect(d.days[0]).toBe('2026-10-13')
    expect(d.days.at(-1)).toBe(RECORDED_DAY)
    // the recording answered every call of the replay: only the four reads of the load-time view reached the network
    expect(api).toHaveLength(4)
    expect(onlyFreeReads()).toBe(true)
  })

  it('Run it live ends the replay and makes the real requests for today', async () => {
    served = jsonResponse(recording())
    const d = deps()
    const { container } = mount(<App deps={d.deps} />)
    await flush(10)
    await wait(300)
    await flush(10)
    await click(byText(container, 'button', 'Run it live'))
    await flush(12)
    expect(container.querySelector('[data-replay-label]')).toBeNull()
    // the live run keeps a banner with its model and cost where the replay label was
    expect(container.querySelector('[data-live-label]')?.textContent).toContain('Live run')
    expect(container.querySelector('[data-live-label]')?.textContent).toContain('claude-haiku-5.5')
    expect(container.querySelector('[data-live-label]')?.textContent).toContain('$0.0064')
    expect(container.querySelector('.ds-run__readout')).not.toBeNull()
    expect(d.days.at(-1)).toBe('2026-10-13')
    expect(api.filter(a => a.method === 'POST' && a.path === '/api/explain')).toHaveLength(4)
  })

  it.each([
    ['missing', () => new Response('', { status: 404 })],
    ['malformed', () => new Response('{"version":1}', { status: 200 })],
    ['stale', () => jsonResponse(recording({}, 4 * 24 * 3_600_000))],
  ])('a %s recording leaves the live view and asks for nothing', async (_name, make) => {
    served = make()
    const d = deps()
    const { container } = mount(<App deps={d.deps} />)
    await flush(10)
    await wait(100)
    await flush(10)
    expect(container.querySelector('[data-replay-label]')).toBeNull()
    expect(container.querySelector('.ds-run__result')).toBeNull()
    expect(container.querySelectorAll('.ds-chips .ds-chip')).toHaveLength(4)
    expect(onlyFreeReads()).toBe(true)
  })

  it('?replay=off never reads the recording', async () => {
    window.history.replaceState(null, '', '/?replay=off')
    served = jsonResponse(recording())
    const { container } = mount(<App deps={deps().deps} />)
    await flush(10)
    await wait(100)
    expect(container.querySelector('[data-replay-label]')).toBeNull()
    expect(vi.mocked(fetch).mock.calls.some(c => String(c[0]) === REPLAY_URL)).toBe(false)
  })

  it('a recording that cannot answer a call ends in the live view, not in a failed run', async () => {
    const bad = recording()
    bad.exchanges = bad.exchanges.filter(e => e.path !== '/api/releases?name=zod')
    served = jsonResponse(bad)
    const d = deps()
    const { container } = mount(<App deps={d.deps} />)
    await flush(10)
    await wait(300)
    await flush(12)
    expect(container.querySelector('[data-replay-label]')).toBeNull()
    expect(container.querySelector('.ds-run__result')).toBeNull()
    expect(container.querySelector('.ds-app')?.getAttribute('data-run')).toBe('idle')
    expect(onlyFreeReads()).toBe(true)
  })
})
