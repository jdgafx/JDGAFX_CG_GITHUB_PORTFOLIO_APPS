import { describe, expect, it } from 'vitest'
import { createAgents } from '../../src/lib/agents'
import { buildSteps, narrowLayout, takenEdges, wideLayout } from '../../src/lib/graphLayout'
import { buildTraceRows, laneFor } from '../../src/lib/traceRows'
import { IDLE_AUDIT } from '../../src/lib/auditState'

describe('layouts', () => {
  it('snakes the six steps three to a row on a wide stage: right, right, down, left, left', () => {
    const wide = wideLayout()
    expect(wide.boxes.map(box => [box.id, box.x, box.y])).toEqual([
      ['retriever', 0, 34],
      ['researcher', 330, 34],
      ['analyst', 660, 34],
      ['critic', 660, 162],
      ['synthesizer', 330, 162],
      ['audit', 0, 162],
    ])
    expect(wide.edges.map(edge => [edge.label, edge.path])).toEqual([
      ['Sources', 'M220 72 H330'],
      ['Research', 'M550 72 H660'],
      ['Analysis', 'M770 110 V162'],
      ['Gaps', 'M660 200 H550'],
      ['Report', 'M330 200 H220'],
    ])
  })

  it('stacks the six steps in one column on a narrow stage', () => {
    const narrow = narrowLayout()
    expect(narrow.boxes.map(box => box.y)).toEqual([8, 108, 208, 308, 408, 508])
    expect(new Set(narrow.edges.map(edge => edge.path.startsWith('M170 ')))).toEqual(new Set([true]))
  })
})

describe('steps', () => {
  it('shows the audit as waiting, then auditing, with the right word and mark', () => {
    const agents = createAgents()
    const idle = buildSteps(agents, { phase: 'idle' })
    expect(idle.map(step => step.id)).toEqual(['retriever', 'researcher', 'analyst', 'critic', 'synthesizer', 'audit'])
    expect(idle[5]).toMatchObject({ mark: 'idle', word: 'Waiting' })
    expect(buildSteps(agents, { phase: 'running' })[5]).toMatchObject({ mark: 'active', word: 'Auditing' })
    expect(buildSteps(agents, { phase: 'done', ms: 3200 })[5]).toMatchObject({ mark: 'ok', word: 'Finished', ms: 3200 })
    expect(buildSteps(agents, { phase: 'failed' })[5]).toMatchObject({ mark: 'failed', word: 'Failed' })
    expect(buildSteps(agents, { phase: 'none' })[5]).toMatchObject({ mark: 'skipped', word: 'Nothing to check' })
  })

  it('marks a hand-off taken once the step it leads to has started', () => {
    const agents = createAgents()
    agents.retriever.status = 'complete'
    agents.researcher.status = 'working'
    expect(takenEdges(buildSteps(agents, { phase: 'idle' }))).toEqual([true, false, false, false, false])
    agents.synthesizer.status = 'complete'
    expect(takenEdges(buildSteps(agents, { phase: 'running' }))[4]).toBe(true)
  })

  it('draws a cut-off stage as a warning with the word "Cut off"', () => {
    const agents = createAgents()
    agents.critic = { ...agents.critic, status: 'complete', finish: 'length' }
    expect(buildSteps(agents, { phase: 'idle' })[3]).toMatchObject({ mark: 'warn', word: 'Cut off' })
  })
})

describe('trace rows', () => {
  it('lists the audit as the sixth line and puts the run on one time axis', () => {
    const agents = createAgents()
    agents.retriever = { ...agents.retriever, status: 'complete', ms: 100, sources: [] }
    agents.researcher = { ...agents.researcher, status: 'complete', ms: 300, detail: 'Facts.', usage: {} }
    const rows = buildTraceRows(buildSteps(agents, { phase: 'idle' }), agents, IDLE_AUDIT)
    expect(rows).toHaveLength(6)
    expect(rows[5]).toMatchObject({ name: 'Audit', detail: 'Waits for the finished report.', meta: [] })
    expect(laneFor(rows)[0]).toEqual({ left: 0, width: 25 })
    expect(laneFor(rows)[1]).toEqual({ left: 25, width: 75 })
    expect(laneFor(rows)[5]).toBeNull()
  })
})
