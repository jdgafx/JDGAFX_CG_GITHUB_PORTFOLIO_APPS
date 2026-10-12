import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CompareResponse, Cost, JudgeResponse, JudgeVerdict, PanelResult, Usage } from '../../netlify/shared/contract'
import { RunTotalsStrip } from '../../src/components/RunTotals'
import { ApiError } from '../../src/lib/api'
import { failedJudge, judgeView } from '../../src/lib/useArena'
import { runTotals, type JudgeView, type RunView } from '../../src/lib/run'

const SUMMARY = { fastest: null, cheapest: null, mostOutputTokens: null, measuredAt: '2026-10-12T00:00:00.000Z' }
const NOTHING: Usage = { prompt_tokens: null, completion_tokens: null, reasoning_tokens: null, total_tokens: null }
const used = (prompt: number, completion: number): Usage => ({ prompt_tokens: prompt, completion_tokens: completion, reasoning_tokens: null, total_tokens: prompt + completion })
const usd = (value: number): Cost => ({ usd: value, source: 'usage' })

function panel(slot: 'A' | 'B' | 'C', over: Partial<PanelResult> = {}): PanelResult {
  return {
    slot,
    requestedModel: `req/${slot}`,
    servedModel: `served/${slot}`,
    ok: true,
    error: null,
    text: 'READY',
    finishReason: 'stop',
    latencyMs: 500,
    usage: used(100, 20),
    cost: usd(0.001),
    ...over,
  }
}

const verdict: JudgeVerdict = {
  ok: true,
  model: 'judge/x',
  latencyMs: 300,
  bestOverall: 'A',
  perPanel: {},
  caveat: '',
  usage: used(400, 100),
  cost: usd(0.004),
  trace: [{ name: 'Judge', status: 'ok', ms: 300, detail: 'judge/x picked Panel A', tokens: 500, cost: usd(0.004) }],
}

function run(panels: PanelResult[], judge: JudgeView): RunView {
  const compare: CompareResponse = { runId: 'r', totalMs: 1000, panels, trace: [], summary: SUMMARY }
  return { status: 'done', mode: 'open', prompt: 'Q', blind: null, compare, judge, error: null, notice: null, vote: { state: 'idle' } }
}

const strip = (view: RunView) => renderToStaticMarkup(createElement(RunTotalsStrip, { run: view }))

describe('run totals count every billed call', () => {
  it('keeps a cut-off panel and an empty panel, which were billed but did not answer', () => {
    const cutOff = panel('B', { ok: false, error: 'Hit the limit', finishReason: 'length', text: '', usage: used(100, 2048), cost: usd(0.01) })
    const empty = panel('C', { ok: false, error: 'The model returned no text', text: '', usage: used(100, 5), cost: usd(0.002) })
    const totals = runTotals(run([panel('A'), cutOff, empty], { state: 'idle' }))
    expect(totals).toMatchObject({ answering: 1, totalTokens: 120 + 2148 + 105, notReported: 0, billedCalls: 3, costedCalls: 3 })
    expect(totals.totalCost?.usd).toBeCloseTo(0.013, 9)
  })

  it('adds the judge to the totals on success, with its own share', () => {
    const totals = runTotals(run([panel('A'), panel('B')], { state: 'done', verdict }))
    expect(totals).toMatchObject({ totalTokens: 240 + 500, panelTokens: 240, judgeTokens: 500 })
    expect(totals.totalCost?.usd).toBeCloseTo(0.006, 9)
    expect(totals.judgeCost).toEqual(usd(0.004))
  })

  it('adds the judge to the totals when it failed after its reply was billed', () => {
    const failed: JudgeView = {
      state: 'failed',
      step: { name: 'Judge', status: 'failed', ms: 300, detail: 'The judge returned no text', tokens: 500, cost: usd(0.004) },
      model: 'judge/x',
      usage: used(400, 100),
      cost: usd(0.004),
      notReported: 0,
    }
    expect(runTotals(run([panel('A'), panel('B')], failed))).toMatchObject({ totalTokens: 740, judgeTokens: 500, notReported: 0 })
  })

  it('marks the totals partial for a panel retry that lost its first call, and for a judge the browser lost', () => {
    const retried = panel('B', { retried: true, notReported: 1 })
    const lost: JudgeView = { state: 'failed', step: { name: 'Judge', status: 'failed', ms: null, detail: 'Stopped', tokens: null, cost: null }, model: null, notReported: 1 }
    expect(runTotals(run([panel('A'), retried], lost))).toMatchObject({ totalTokens: 240, notReported: 2 })
  })

  it('reports no figure, only the count, when no call returned usage', () => {
    const timedOut = (slot: 'A' | 'B') => panel(slot, { ok: false, error: 'timeout', text: '', finishReason: null, usage: NOTHING, cost: null, notReported: 2 })
    const totals = runTotals(run([timedOut('A'), timedOut('B')], { state: 'idle' }))
    expect(totals).toMatchObject({ totalTokens: null, totalCost: null, notReported: 4 })
  })
})

describe('the run totals strip', () => {
  it('shows the sum of panels and judge, with the judge named apart', () => {
    const html = strip(run([panel('A'), panel('B')], { state: 'done', verdict }))
    expect(html).toContain('740')
    expect(html).toContain('$0.006000')
    expect(html).toContain('judge 500')
    expect(html).toContain('judge $0.004000')
    expect(html).not.toContain('at least')
  })

  it('says at least, with the count of calls not reported, when a call was lost', () => {
    const html = strip(run([panel('A'), panel('B', { retried: true, notReported: 1 })], { state: 'done', verdict }))
    expect(html).toContain('at least 740')
    expect(html).toContain('at least $0.006000')
    expect(html).toContain('1 call not reported')
  })

  it('shows not reported when no call returned usage', () => {
    const timedOut = panel('A', { ok: false, error: 'timeout', text: '', finishReason: null, usage: NOTHING, cost: null, notReported: 2 })
    const html = strip(run([timedOut], { state: 'idle' }))
    expect(html).toContain('not reported')
    expect(html).toContain('2 calls not reported')
  })
})

describe('the judge view the page builds', () => {
  const failure: JudgeResponse = {
    ok: false,
    reason: 'The judge returned no text',
    model: 'judge/x',
    latencyMs: 300,
    usage: used(400, 100),
    cost: usd(0.004),
    notReported: 0,
    trace: [{ name: 'Judge', status: 'failed', ms: 300, detail: 'The judge returned no text', tokens: 500, cost: usd(0.004) }],
  }

  it('keeps the billed usage of a judge failure that the server reported', () => {
    expect(judgeView(failure)).toMatchObject({ state: 'failed', usage: used(400, 100), cost: usd(0.004), notReported: 0 })
    expect(judgeView(verdict)).toEqual({ state: 'done', verdict })
  })

  it('counts a judge call the browser lost as not reported, but not one the server refused', () => {
    expect(failedJudge('Stopped before the judge answered.', new DOMException('x', 'AbortError'))).toMatchObject({ notReported: 1 })
    expect(failedJudge('Could not reach the server.', new ApiError('Could not reach the server.'))).toMatchObject({ notReported: 1 })
    expect(failedJudge('Bad request', new ApiError('Bad request', 400))).toMatchObject({ notReported: 0 })
  })
})
