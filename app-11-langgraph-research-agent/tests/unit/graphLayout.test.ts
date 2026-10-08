import { describe, expect, it } from 'vitest'
import {
  MAX_REVISIONS as SERVER_MAX_REVISIONS,
  MAX_TOOL_ROUNDS as SERVER_MAX_TOOL_ROUNDS,
} from '../../netlify/shared/graph/state'
import { MAX_REVISIONS, MAX_TOOL_ROUNDS } from '../../src/lib/constants'
import {
  EDGES,
  END_KEY,
  displayLabel,
  labelText,
  shownMark,
  traversedEdges,
  type EdgeShape,
} from '../../src/lib/graphLayout'
import type { NodeMark, TraceEntry } from '../../src/lib/runState'

const row = (node: TraceEntry['node'], visit: number, status: TraceEntry['status'] = 'ok'): TraceEntry => ({
  key: `${node}-${visit}`,
  node,
  visit,
  status,
  detail: '',
})

function edgeFor(key: string): EdgeShape {
  const found = EDGES.find((edge) => edge.key === key)
  if (!found) throw new Error(`no edge ${key}`)
  return found
}

describe('traversedEdges', () => {
  it('reads every hop of a run from the trace, fixed edges and the end included', () => {
    const trace = [
      row('plan', 1),
      row('agent', 1),
      row('tools', 1),
      row('agent', 2),
      row('draft', 1),
      row('critic', 1),
      row('final', 1),
    ]
    expect(Array.from(traversedEdges(trace)).sort()).toEqual([
      'agent>draft',
      'agent>tools',
      'critic>final',
      'draft>critic',
      END_KEY,
      'plan>agent',
      'tools>agent',
    ])
  })

  it('keeps the revise loop, and leaves the end out when the final step did not finish', () => {
    const trace = [
      row('plan', 1),
      row('agent', 1),
      row('draft', 1),
      row('critic', 1),
      row('draft', 2),
      row('critic', 2),
      row('final', 1, 'failed'),
    ]
    expect(Array.from(traversedEdges(trace)).sort()).toEqual([
      'agent>draft',
      'critic>draft',
      'critic>final',
      'draft>critic',
      'plan>agent',
    ])
  })

  it('is empty before any step has run', () => {
    expect(traversedEdges([]).size).toBe(0)
  })
})

describe('shownMark', () => {
  const marks = (agent: NodeMark) => ({
    plan: 'ok' as const,
    agent,
    tools: 'ok' as const,
    draft: 'ok' as const,
    critic: 'ok' as const,
    final: 'ok' as const,
  })

  it('shows a step as finished when an earlier visit finished and its last visit was skipped', () => {
    const trace = [row('agent', 1), row('tools', 1), row('agent', 4, 'skipped')]
    expect(shownMark('agent', marks('skipped'), trace)).toBe('ok')
  })

  it('keeps skipped when no visit of the step finished', () => {
    expect(shownMark('agent', marks('skipped'), [row('agent', 1, 'skipped')])).toBe('skipped')
  })

  it('passes other marks through unchanged', () => {
    expect(shownMark('agent', marks('active'), [])).toBe('active')
  })
})

describe('edge labels', () => {
  it('turns the server label into the page wording', () => {
    expect(displayLabel('tools (round 2 of 4)')).toBe('tools, round 2 of 4')
    expect(displayLabel('draft (no more searches)')).toBe('draft, no more searches')
    expect(displayLabel('revise (1 of 2)')).toBe('revise, 1 of 2')
  })

  it('shows the bound before a decision and the decision after it', () => {
    const tools = edgeFor('agent>tools')
    expect(labelText(tools, {})).toBe(`tools, up to ${MAX_TOOL_ROUNDS} rounds`)
    expect(labelText(tools, { 'agent>tools': 'tools (round 3 of 4)' })).toBe('tools, round 3 of 4')
    expect(labelText(edgeFor('plan>agent'), {})).toBeUndefined()
  })

  it('keeps the page limits equal to the server limits', () => {
    expect(MAX_TOOL_ROUNDS).toBe(SERVER_MAX_TOOL_ROUNDS)
    expect(MAX_REVISIONS).toBe(SERVER_MAX_REVISIONS)
  })
})
