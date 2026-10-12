import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reviewCode } from '../../src/lib/api'
import { recordsThisRun, replayDisabled, REPLAY_URL } from '../../src/lib/useReplay'
import { recordedCost } from '../../src/components/ReplayLabel'
import { installReplayShim, replayLabel, type Exchange, type Recording } from '../../src/replay'

const CODE = 'a\nx\nc'
const FIRST = {
  success: true,
  stage: 'review',
  result: { comments: [], lineCount: 3, truncated: false, verified: false, malformed: 0, mode: 'file', pr: null },
  candidates: [{ id: 1, line: 2, fromLine: 2, quote: 'x', severity: 'info', message: 'm', suggestion: 's', moveNote: null, loweredFrom: null }],
  dropped: [],
  batches: [[1]],
  handoff: { id: 'abc', text: 't', seals: { 'read-1': ['s1'], 'read-2': ['s2'] } },
  trace: [],
  usage: { total_tokens: 10, cost: 0.001 },
  model: 'm/one',
  totalMs: 5,
}
const READ_1 = { success: true, rows: [{ id: 1, line: 2, verdict: 'kept', decidedBy: 'verifier', reason: 'r', evidence: 'x', support: null, supportAt: null, claimKind: null }], trace: [], usage: { total_tokens: 4, cost: 0.0005 }, model: 'm/one' }
const READ_2 = { success: true, rows: [{ id: 1, state: 'stands', reason: 'r', quote: null }], trace: [], usage: { total_tokens: 4, cost: 0.0005 }, model: 'm/one' }

function exchange(path: string, request: unknown, body: unknown, t: number): Exchange {
  const text = JSON.stringify(body)
  return { method: 'POST', path, request_body: JSON.stringify(request), status: 200, headers: { 'content-type': 'application/json' }, t_start: t, t_headers: t + 50, t_end: t + 100, chunks: [{ t: t + 100, text }] }
}

function recording(): Recording {
  const payload = { code: CODE, language: 'javascript' }
  const handoff = (seal: string) => ({ ...payload, handoff: { text: 't', seal } })
  return {
    version: 1,
    app: 'app-03-ai-code-review',
    url: 'https://example.test/',
    recorded_at: '2026-10-12T12:00:00.000Z',
    reported: { model: 'm/one', model_role: 'reviewed by', cost_usd: 0.001, cost_scope: 'first pass' },
    exchanges: [
      exchange('/api/ai', payload, FIRST, 0),
      exchange('/api/ai/read-1?batch=0&review=abc', handoff('s1'), READ_1, 200),
      exchange('/api/ai/read-2?batch=0&review=abc', handoff('s2'), READ_2, 200),
    ],
  }
}

describe('replay glue', () => {
  it('reads the recording from the fixed public URL on the replays branch', () => {
    expect(REPLAY_URL).toBe('https://raw.githubusercontent.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/replays/app-03-ai-code-review.json')
  })

  it('is switched off by ?replay=off, which the recorder uses', () => {
    expect(replayDisabled('?replay=off')).toBe(true)
    expect(replayDisabled('')).toBe(false)
    expect(replayDisabled('?replay=on')).toBe(false)
  })

  it('replays only a recording of the review the example would start now', () => {
    const rec = recording()
    expect(recordsThisRun(rec, CODE, 'javascript')).toBe(true)
    expect(recordsThisRun(rec, `${CODE}\n`, 'javascript')).toBe(false)
    expect(recordsThisRun(rec, CODE, 'typescript')).toBe(false)
    expect(recordsThisRun({ ...rec, exchanges: rec.exchanges.slice(1) }, CODE, 'javascript')).toBe(false)
  })

  it('labels the replay from the recording: age, model and the cost it reports', () => {
    const label = replayLabel(recording(), Date.parse('2026-10-12T14:00:00.000Z'), 1)
    expect(label).toEqual({ age: '2 h ago', model: 'reviewed by m/one', cost: 'first pass $0.001000', speedNote: null })
  })
})

describe('replay label cost', () => {
  it('adds up the cost of every recorded reply, the figure the readout shows', () => {
    expect(recordedCost(recording())).toBeCloseTo(0.002, 9)
  })

  it('gives none when a reply reports no cost', () => {
    const rec = recording()
    rec.exchanges[1] = { ...rec.exchanges[1], chunks: [{ t: 300, text: '{"success":true}' }] }
    expect(recordedCost(rec)).toBeNull()
  })
})

describe('replay through the app\'s own client', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('sends the very body the recording holds, so a recording made by the live client always matches', async () => {
    const stub = vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'stop' }), { status: 400 }))
    vi.stubGlobal('fetch', stub)
    await reviewCode(CODE, 'javascript').catch(() => null)
    expect((stub.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBe(recording().exchanges[0].request_body)
  })

  it('runs reviewCode on the recorded replies, both reads included, with no request to the network', async () => {
    const network = vi.fn(async () => Response.json({ real: true }))
    vi.stubGlobal('fetch', network)
    installReplayShim(recording(), { target: globalThis, origin: 'http://app.test', speed: 1 })
    const running = reviewCode(CODE, 'javascript')
    await vi.advanceTimersByTimeAsync(1000)
    const run = await running
    expect(network).not.toHaveBeenCalled()
    expect(run.result.verified).toBe(true)
    expect(run.result.comments).toHaveLength(1)
    expect(run.result.comments[0]).toMatchObject({ verdict: 'kept', message: 'm' })
    expect(globalThis.fetch).toBe(network)
  })

  it('does not answer a different review: it ends and the next call is the page\'s own', async () => {
    const network = vi.fn(async () => Response.json({ real: true }))
    vi.stubGlobal('fetch', network)
    const diverged = vi.fn()
    installReplayShim(recording(), { target: globalThis, origin: 'http://app.test', speed: 1, onDiverge: diverged })
    const controller = new AbortController()
    diverged.mockImplementation(() => controller.abort())
    await expect(reviewCode('other code', 'javascript', controller.signal)).rejects.toBeDefined()
    expect(diverged).toHaveBeenCalledTimes(1)
    expect(network).not.toHaveBeenCalled()
  })
})
