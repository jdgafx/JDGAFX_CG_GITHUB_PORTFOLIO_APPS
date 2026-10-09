import { describe, expect, it } from 'vitest'
import {
  MODEL,
  type CatalogueResponse,
  type CompareResponse,
  type CompareSummary,
  type JudgeVerdict,
  type ModelOption,
  type PanelResult,
  type Usage,
} from '../../netlify/shared/contract'
import {
  blockedReason,
  chooseOption,
  DEFAULT_PICKS,
  failedJudgeStep,
  listed,
  panelNote,
  panelStatus,
  runTotals,
  statusLine,
  statusText,
  traceSteps,
  verdictSentences,
  type JudgeView,
  type RunView,
} from '../../src/lib/run'

function option(id: string, inPerM: number | null = null, outPerM: number | null = null): ModelOption {
  return { id, label: id, why: '', inPerM, outPerM, contextLength: null }
}

const catalogue: CatalogueResponse = {
  source: 'live',
  fetchedAt: '2026-10-08T12:00:00.000Z',
  defaultModel: MODEL,
  groups: [
    { label: 'Speed and latency', options: [option('google/gemini-2.5-flash-lite', 0.1, 0.5)] },
    { label: 'Agentic and coding', options: [option('anthropic/claude-sonnet-5', 3, 15)] },
  ],
}

function usage(prompt: number | null, completion: number | null): Usage {
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    reasoning_tokens: null,
    total_tokens: prompt !== null && completion !== null ? prompt + completion : null,
  }
}

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
    usage: usage(10, 3),
    cost: null,
    ...over,
  }
}

const verdict: JudgeVerdict = {
  ok: true,
  model: 'judge/x',
  latencyMs: 300,
  bestOverall: 'A',
  perPanel: { A: 'Correct.' },
  caveat: 'One sample.',
  usage: usage(60, 20),
  cost: null,
  trace: [{ name: 'Judge', status: 'ok', ms: 300, detail: 'judge/x picked Panel A', tokens: 80, cost: null }],
}

function compareOf(panels: PanelResult[], summary: CompareSummary): CompareResponse {
  return {
    runId: 'run-1',
    totalMs: 1000,
    panels,
    trace: panels.map(p => ({
      name: `Panel ${p.slot} request`,
      status: p.ok ? 'ok' : 'failed',
      ms: p.latencyMs,
      detail: p.error ?? 'Served',
      tokens: p.usage.total_tokens,
      cost: p.cost,
    })),
    summary,
  }
}

const emptySummary: CompareSummary = { fastest: null, cheapest: null, mostOutputTokens: null, measuredAt: '2026-10-08T12:00:00.000Z' }

const idle: JudgeView = { state: 'idle' }

describe('model picks', () => {
  it('knows whether the list offers an ID', () => {
    expect(listed(catalogue, 'anthropic/claude-sonnet-5')).toBe(true)
    expect(listed(catalogue, 'vendor/none')).toBe(false)
  })

  it('keeps a pick the list still offers, and otherwise takes the first option', () => {
    expect(chooseOption(catalogue, 'anthropic/claude-sonnet-5')).toBe('anthropic/claude-sonnet-5')
    expect(chooseOption(catalogue, 'vendor/none')).toBe('google/gemini-2.5-flash-lite')
  })
})

describe('panelStatus', () => {
  it('reads a complete, capped and failed panel', () => {
    expect(panelStatus(panel('A'))).toEqual({ label: 'Complete', dot: 'ds-dot--ok' })
    expect(panelStatus(panel('A', { finishReason: 'length' }))).toEqual({ label: 'Capped at 2048 tokens', dot: 'arena-dot--warn' })
    expect(panelStatus(panel('A', { ok: false, error: 'x' }))).toEqual({ label: 'Failed', dot: 'ds-dot--failed' })
  })
})

describe('statusLine', () => {
  it('describes each stage of a run for screen readers', () => {
    const base = { compare: null, judge: idle, error: null }
    expect(statusLine(null)).toBe('')
    expect(statusLine({ ...base, status: 'running' })).toBe('Running the three panels.')
    expect(statusLine({ ...base, status: 'running', compare: compareOf([panel('A')], emptySummary) })).toBe(
      'Asking the judge for an opinion.',
    )
    expect(statusLine({ ...base, status: 'stopped' })).toBe('Stopped.')
    expect(statusLine({ ...base, status: 'error', error: 'Could not reach the server.' })).toBe('Could not reach the server.')
    const panels = [panel('A'), panel('B'), panel('C', { ok: false, error: 'x' })]
    expect(statusLine({ ...base, status: 'done', compare: compareOf(panels, emptySummary) })).toBe(
      'Comparison finished. 2 of 3 panels answered.',
    )
  })
})

describe('verdictSentences', () => {
  it('builds the three evidence sentences from measured values', () => {
    const summary: CompareSummary = {
      fastest: { slot: 'B', model: 'm/b', latencyMs: 812.4 },
      cheapest: { slot: 'B', model: 'm/b', usd: 0.0002, source: 'estimated' },
      mostOutputTokens: { slot: 'A', model: 'm/a', tokens: 310 },
      measuredAt: '2026-10-08T12:00:00.000Z',
    }
    expect(verdictSentences(summary)).toEqual([
      'Fastest: m/b at 812 ms',
      'Cheapest: m/b at $0.000200 (estimated)',
      'Most output: m/a with 310 tokens',
    ])
  })

  it('says what is missing when no panel has a number', () => {
    expect(verdictSentences(emptySummary)).toEqual([
      'Fastest: no panel completed',
      'Cheapest: no panel reported a cost',
      'Most output: no panel reported output tokens',
    ])
  })
})

describe('runTotals', () => {
  const panels = [
    panel('A', { usage: usage(10, 3), cost: { usd: 0.0004, source: 'usage' } }),
    panel('B', { usage: usage(20, 5), cost: null }),
    panel('C', { ok: false, error: 'x', usage: usage(null, null), latencyMs: null }),
  ]

  it('adds up the answering panels and the judge time', () => {
    const run: RunView = { status: 'done', compare: compareOf(panels, emptySummary), judge: { state: 'done', verdict }, error: null }
    expect(runTotals(run)).toEqual({
      runMs: 1300,
      answering: 2,
      promptTokens: 30,
      outputTokens: 8,
      totalTokens: 38,
      panelCost: { usd: 0.0004, source: 'usage' },
      costedPanels: 1,
      judgeModel: 'judge/x',
    })
  })

  it('marks the panel cost as partly estimated when any panel cost is estimated', () => {
    const estimated = [panel('A', { cost: { usd: 0.0004, source: 'usage' } }), panel('B', { cost: { usd: 0.0001, source: 'estimated' } })]
    const run: RunView = { status: 'done', compare: compareOf(estimated, emptySummary), judge: idle, error: null }
    expect(runTotals(run).panelCost).toEqual({ usd: 0.0005, source: 'estimated' })
  })

  it('has no run time while the judge is still running', () => {
    const run: RunView = { status: 'running', compare: compareOf(panels, emptySummary), judge: { state: 'running' }, error: null }
    expect(runTotals(run)).toMatchObject({ runMs: null, judgeModel: 'running' })
  })

  it('reports nothing when no run has started the panels', () => {
    const run: RunView = { status: 'error', compare: null, judge: idle, error: 'x' }
    expect(runTotals(run)).toMatchObject({
      answering: 0,
      promptTokens: null,
      panelCost: null,
      costedPanels: 0,
      judgeModel: 'not run',
    })
  })
})

describe('traceSteps', () => {
  it('lists the three panel steps and then the judge step from the server', () => {
    const run: RunView = {
      status: 'done',
      compare: compareOf([panel('A'), panel('B'), panel('C')], emptySummary),
      judge: { state: 'done', verdict },
      error: null,
    }
    const steps = traceSteps(run)
    expect(steps.map(s => s.name)).toEqual(['Panel A request', 'Panel B request', 'Panel C request', 'Judge'])
    expect(steps[3]).toEqual(verdict.trace[0])
  })

  it('shows the compare request as waiting, failed or stopped before the panels answer', () => {
    expect(traceSteps({ status: 'running', compare: null, judge: idle, error: null })).toEqual([
      { name: 'Compare request', status: 'running', ms: null, detail: 'Waiting for the three panels', tokens: null, cost: null },
    ])
    expect(traceSteps({ status: 'error', compare: null, judge: idle, error: 'Could not reach the server.' })).toEqual([
      { name: 'Compare request', status: 'failed', ms: null, detail: 'Could not reach the server.', tokens: null, cost: null },
    ])
    expect(traceSteps({ status: 'stopped', compare: null, judge: idle, error: null })[0]).toMatchObject({
      name: 'Compare request',
      status: 'failed',
      detail: 'Stopped before the panels answered',
    })
  })

  it('marks a judge that was skipped because two answers were not available', () => {
    const run: RunView = {
      status: 'done',
      compare: compareOf([panel('A')], emptySummary),
      judge: { state: 'skipped', reason: 'The judge needs two answers. 1 of 3 panels answered.' },
      error: null,
    }
    expect(traceSteps(run)[1]).toEqual({
      name: 'Judge',
      status: 'skipped',
      ms: null,
      detail: 'The judge needs two answers. 1 of 3 panels answered.',
      tokens: null,
      cost: null,
    })
  })
})

describe('failedJudgeStep', () => {
  it('builds a failed judge step with only the reason', () => {
    expect(failedJudgeStep('Could not reach the server.')).toEqual({
      name: 'Judge',
      status: 'failed',
      ms: null,
      detail: 'Could not reach the server.',
      tokens: null,
      cost: null,
    })
  })
})

describe('blockedReason and the idle status line', () => {
  const picks = { B: 'google/gemini-2.5-flash-lite', C: 'anthropic/claude-sonnet-5' }
  const IDLE = 'Ready. Choose Compare models to send the prompt to all three panels.'

  it('names what stops Compare, in the order a visitor can fix it', () => {
    expect(blockedReason(null, picks, 'Hi')).toBe('Wait for the model list to load.')
    expect(blockedReason(catalogue, { ...picks, C: 'vendor/none' }, 'Hi')).toBe('Choose panel B and C models from the list.')
    expect(blockedReason(catalogue, picks, '   ')).toBe('Enter a prompt, or choose a sample prompt.')
    expect(blockedReason(catalogue, picks, 'x'.repeat(4001))).toBe('Shorten the prompt to 4,000 characters or fewer.')
    expect(blockedReason(catalogue, picks, 'x'.repeat(4000))).toBeNull()
  })

  it('shows the blocked reason before a run, and the ready line only when Compare can run', () => {
    const empty = blockedReason(catalogue, picks, '')
    expect(statusText(null, empty)).toBe('Enter a prompt, or choose a sample prompt.')
    expect(statusText(null, blockedReason(catalogue, picks, 'x'.repeat(4001)))).toBe(
      'Shorten the prompt to 4,000 characters or fewer.',
    )
    expect(statusText(null, blockedReason(catalogue, picks, 'Hi'))).toBe(IDLE)
  })

  it('leaves the status of a finished or failed run to the run itself', () => {
    const base = { compare: null, judge: idle, error: null }
    expect(statusText({ ...base, status: 'error', error: 'x' }, 'Enter a prompt, or choose a sample prompt.')).toBe(
      'Comparison did not finish.',
    )
    expect(statusText({ ...base, status: 'stopped' }, null)).toBe('Stopped.')
  })

  it('starts from picks the catalogue fixture lists', () => {
    expect(DEFAULT_PICKS).toEqual(picks)
  })
})

describe('panelNote', () => {
  it('shows a note as written and says so when the judge left it blank', () => {
    expect(panelNote('Correct sum.')).toBe('Correct sum.')
    expect(panelNote('')).toBe('The judge gave no note for this panel.')
    expect(panelNote('  \n')).toBe('The judge gave no note for this panel.')
    expect(panelNote(undefined)).toBe('The judge gave no note for this panel.')
  })
})
