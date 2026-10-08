import { describe, expect, it } from 'vitest'
import { initialRunState, type RunState } from '../../src/lib/runState'
import { buildTraceRows, expectationOf, formatMs, metricsFor, overlapWith, statusSummary, stepLabel } from '../../src/lib/trace'
import type { BotStep } from '../../src/types'

const navigate: BotStep = { action: 'navigate', target: 'Google home page', thought: 'Open the home page.', url: 'https://www.google.com/' }
const click: BotStep = { action: 'click', target: 'Search button', thought: 'Submit the search.' }
const extract: BotStep = { action: 'extract', target: 'page title', thought: 'Read the title.', value: 'The page title' }
const verify: BotStep = { action: 'verify', target: 'results', thought: 'Check the results.', value: 'Results' }

function stateWith(patch: Partial<RunState>): RunState {
  return { ...initialRunState, ...patch }
}

function metricsByLabel(state: RunState): Record<string, { value: string; hint: string }> {
  return Object.fromEntries(metricsFor(state).map((metric) => [metric.label, { value: metric.value, hint: metric.hint }]))
}

describe('labels and figures', () => {
  it('formats milliseconds with a thousands separator', () => {
    expect(formatMs(1234)).toBe('1,234 ms')
    expect(formatMs(0)).toBe('0 ms')
  })

  it('labels a step the way the server labels its run rows', () => {
    expect(stepLabel(click)).toBe('Click: Search button')
  })
})

describe('metricsFor', () => {
  it('shows latency, tokens, cost and the served model from the planner call', () => {
    const metrics = metricsByLabel(stateWith({
      phase: 'complete',
      steps: [navigate, extract],
      usage: { prompt_tokens: 812, completion_tokens: 164, total_tokens: 976, cost: 0.0002 },
      model: 'anthropic/claude-haiku-5.5',
      planMs: 1200,
      runMs: 5000,
    }))
    expect(metrics['Total latency']).toEqual({ value: '6,200 ms', hint: 'Planner 1,200 ms, browser 5,000 ms.' })
    expect(metrics['Prompt tokens']).toEqual({ value: '812', hint: 'Planner call' })
    expect(metrics['Completion tokens']).toEqual({ value: '164', hint: 'Planner call' })
    expect(metrics['Total tokens']).toEqual({ value: '976', hint: 'Planner call' })
    expect(metrics['Cost (USD)']).toEqual({ value: '$0.0002', hint: 'From usage.cost in the provider response' })
    expect(metrics['Served model']).toEqual({ value: 'anthropic/claude-haiku-5.5', hint: 'Reported by the planner response' })
  })

  it('says "not reported" for figures the provider left out, and never invents a cost', () => {
    const metrics = metricsByLabel(stateWith({
      phase: 'complete',
      usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null, cost: null },
      model: null,
      planMs: 900,
      runMs: 3000,
    }))
    expect(metrics['Prompt tokens'].value).toBe('not reported')
    expect(metrics['Total tokens'].value).toBe('not reported')
    expect(metrics['Cost (USD)'].value).toBe('not reported')
    expect(metrics['Served model'].value).toBe('not reported')
  })

  it('shows dashes before any planner call or browser run', () => {
    const metrics = metricsByLabel(stateWith({ phase: 'idle' }))
    expect(metrics['Total latency']).toEqual({ value: '—', hint: 'Shown once the browser run finishes.' })
    expect(metrics['Prompt tokens'].value).toBe('—')
    expect(metrics['Cost (USD)'].value).toBe('—')
    expect(metrics['Served model'].value).toBe('—')
  })

  it('counts only the browser run for a replay, which makes no model call', () => {
    const metrics = metricsByLabel(stateWith({ phase: 'complete', usage: null, model: null, planMs: null, runMs: 4000 }))
    expect(metrics['Total latency']).toEqual({ value: '4,000 ms', hint: 'Browser run only. A replay makes no model call.' })
    expect(metrics['Prompt tokens'].value).toBe('—')
  })
})

describe('buildTraceRows', () => {
  it('shows the planner as running while the plan is made', () => {
    const rows = buildTraceRows(stateWith({ phase: 'planning' }))
    expect(rows).toEqual([{
      key: 'planning',
      name: 'Planning the steps',
      status: 'running',
      ms: null,
      detail: 'Waiting for the model to answer.',
    }])
  })

  it('lists planner stages, then run rows with their planned thought, then the steps not reached', () => {
    const rows = buildTraceRows(stateWith({
      phase: 'failed',
      steps: [navigate, click, extract],
      planTrace: [{ name: 'Model call', status: 'ok', ms: 1000, detail: 'Served by m.' }],
      rows: [
        { index: 0, name: 'Navigate: Google home page', status: 'ok', ms: 900, detail: 'Opened www.google.com.' },
        { index: 1, name: 'Click: Search button', status: 'failed', ms: 300, detail: 'Search button could not be clicked.' },
      ],
      error: { message: 'Search button could not be clicked.', index: 1 },
    }))
    expect(rows.map((row) => row.key)).toEqual(['plan-0', 'run-0', 'run-1', 'pending-2'])
    expect(rows[1]).toMatchObject({ status: 'ok', ms: 900, planned: 'Open the home page.' })
    expect(rows[2]).toMatchObject({ status: 'failed', ms: 300, planned: 'Submit the search.' })
    expect(rows[3]).toMatchObject({
      name: 'Extract: page title',
      status: 'skipped',
      ms: null,
      detail: 'Not run: an earlier stage failed.',
    })
  })

  it('marks unreached steps as skipped after a stop, and as waiting while the run is live', () => {
    const stopped = buildTraceRows(stateWith({ phase: 'stopped', steps: [navigate, extract], rows: [] }))
    expect(stopped.map((row) => [row.status, row.detail])).toEqual([
      ['skipped', 'Not run: the run was stopped.'],
      ['skipped', 'Not run: the run was stopped.'],
    ])

    const live = buildTraceRows(stateWith({ phase: 'running', steps: [navigate, extract], rows: [] }))
    expect(live.map((row) => [row.status, row.detail])).toEqual([
      ['waiting', 'Waits for the steps before it.'],
      ['waiting', 'Waits for the steps before it.'],
    ])
  })
})

describe('statusSummary', () => {
  const steps = [navigate, click, verify]

  it('describes each phase in one line', () => {
    expect(statusSummary(stateWith({ phase: 'idle' }))).toBe('No run yet.')
    expect(statusSummary(stateWith({ phase: 'planning' }))).toBe('Planning the steps.')
    expect(statusSummary(stateWith({ phase: 'running', steps: [navigate], rows: [] }))).toBe('Starting the browser session.')
    expect(statusSummary(stateWith({ phase: 'complete', steps }))).toBe('All 3 steps finished. Check the observed page against your task.')
  })

  it('names the live step while running', () => {
    const summary = statusSummary(stateWith({
      phase: 'running',
      steps,
      rows: [
        { index: 0, name: 'Navigate: Google home page', status: 'ok', ms: 900, detail: 'Opened www.google.com.' },
        { index: 1, name: 'Click: Search button', status: 'running', ms: 0, detail: 'Running.' },
      ],
    }))
    expect(summary).toBe('Running step 2 of 3: Click: Search button.')
  })

  it('counts only finished steps after a stop, not the stage rows', () => {
    const summary = statusSummary(stateWith({
      phase: 'stopped',
      steps,
      rows: [
        { index: null, name: 'Open browser session', status: 'ok', ms: 10, detail: 'Browser session started.' },
        { index: 0, name: 'Navigate: Google home page', status: 'ok', ms: 900, detail: 'Opened www.google.com.' },
        { index: 1, name: 'Click: Search button', status: 'ok', ms: 400, detail: 'Clicked Search button.' },
      ],
    }))
    expect(summary).toBe('Stopped after 2 of 3 steps. No task result was produced.')
  })

  it('names the failed step, or shows the message alone when no step failed', () => {
    expect(statusSummary(stateWith({
      phase: 'failed',
      steps,
      error: { message: 'Search button could not be clicked.', index: 1 },
    }))).toBe('Step 2 of 3 failed: Search button could not be clicked.')

    expect(statusSummary(stateWith({
      phase: 'failed',
      steps,
      error: { message: 'The browser provider is out of credit, so no session was started.', index: null },
    }))).toBe('The browser provider is out of credit, so no session was started.')

    expect(statusSummary(stateWith({ phase: 'failed', steps }))).toBe('The run failed.')
  })
})

describe('expectationOf', () => {
  it('uses the last extract or verify step, target and value together', () => {
    expect(expectationOf([navigate, click, extract])).toBe('page title The page title')
  })

  it('is null when the plan has no extract or verify step', () => {
    expect(expectationOf([navigate, click])).toBeNull()
  })
})

describe('overlapWith', () => {
  it('counts "title" as found when the observed page has a title', () => {
    const overlap = overlapWith('Google title shows the page', {
      url: 'https://www.google.com/',
      title: 'Google',
      excerpt: 'Search results',
    })
    expect(overlap).toEqual({ found: ['google', 'title'], missing: [] })
  })

  it('lists the expected terms that do not appear anywhere on the page', () => {
    const overlap = overlapWith('Google title shows the page', {
      url: 'https://www.google.com/',
      title: '',
      excerpt: 'Search results',
    })
    expect(overlap).toEqual({ found: [], missing: ['google', 'title'] })
  })

  it('finds an expected term in the page text', () => {
    const overlap = overlapWith('Google title shows the page', {
      url: 'https://www.google.com/',
      title: 'Untitled',
      excerpt: 'Google results for the title',
    })
    expect(overlap).toEqual({ found: ['google', 'title'], missing: [] })
  })
})
