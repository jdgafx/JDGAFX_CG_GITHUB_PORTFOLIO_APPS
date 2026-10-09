import { describe, expect, it } from 'vitest'
import { createAgents, foundNoSources, statusView } from '../../src/lib/agents'
import { buildEdges, buildNodes, derivePhase, edgeHandles, nodePosition, settleAgents, traceDetail, traceMeta } from '../../src/lib/pipeline'

describe('nodePosition', () => {
  it('snakes five steps three to a row: right, right, down, then back left', () => {
    expect([0, 1, 2, 3, 4].map(i => nodePosition(i, 'cols3'))).toEqual([
      { x: 0, y: 0 },
      { x: 208, y: 0 },
      { x: 416, y: 0 },
      { x: 416, y: 168 },
      { x: 208, y: 168 },
    ])
  })

  it('snakes five steps two to a row on phones', () => {
    expect([0, 1, 2, 3, 4].map(i => nodePosition(i, 'cols2'))).toEqual([
      { x: 0, y: 0 },
      { x: 208, y: 0 },
      { x: 208, y: 168 },
      { x: 0, y: 168 },
      { x: 0, y: 336 },
    ])
  })
})

describe('edges', () => {
  it('joins the sides that face each other', () => {
    expect(edgeHandles({ x: 0, y: 0 }, { x: 208, y: 0 })).toEqual({ sourceHandle: 'source-right', targetHandle: 'target-left' })
    expect(edgeHandles({ x: 416, y: 168 }, { x: 208, y: 168 })).toEqual({ sourceHandle: 'source-left', targetHandle: 'target-right' })
    expect(edgeHandles({ x: 416, y: 0 }, { x: 416, y: 168 })).toEqual({ sourceHandle: 'source-bottom', targetHandle: 'target-top' })
  })

  it('draws four labelled edges from Retrieve to the Synthesizer and marks one taken once its target starts', () => {
    const agents = createAgents()
    agents.researcher.status = 'working'
    const edges = buildEdges(agents, 'cols3')
    expect(edges.map(edge => [edge.source, edge.target, edge.label, edge.sourceHandle])).toEqual([
      ['retriever', 'researcher', 'Sources', 'source-right'],
      ['researcher', 'analyst', 'Research', 'source-right'],
      ['analyst', 'critic', 'Analysis', 'source-bottom'],
      ['critic', 'synthesizer', 'Gaps', 'source-left'],
    ])
    expect(edges.map(edge => edge.className)).toEqual([
      'pipeline-edge pipeline-edge--taken',
      'pipeline-edge',
      'pipeline-edge',
      'pipeline-edge',
    ])
    expect(buildEdges(agents, 'cols2').map(edge => edge.sourceHandle)).toEqual(['source-right', 'source-bottom', 'source-left', 'source-bottom'])
  })

  it('builds one node per step, Retrieve first', () => {
    expect(buildNodes(createAgents(), 'cols3').map(node => node.id)).toEqual(['retriever', 'researcher', 'analyst', 'critic', 'synthesizer'])
  })
})

describe('retriever status and trace', () => {
  it('shows "No sources" in the warning dot when Retrieve finished with an empty list', () => {
    const retriever = { ...createAgents().retriever, status: 'complete' as const, sources: [] }
    expect(foundNoSources(retriever)).toBe(true)
    expect(statusView(retriever)).toEqual({ word: 'No sources', dot: 'ds-dot app-dot--warning' })
    expect(statusView({ ...retriever, sources: [{ n: 1, title: 'T', site: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/T', snippet: 's' }] }).word).toBe('Finished')
  })

  it('counts sources on the Retrieve trace line and tokens and cost on a model line', () => {
    const agents = createAgents()
    expect(traceMeta(agents.retriever)).toEqual([])
    const one = { ...agents.retriever, status: 'complete' as const, sources: [{ n: 1, title: 'T', site: 'Wikipedia' as const, url: 'https://en.wikipedia.org/wiki/T', snippet: 's' }] }
    expect(traceMeta(one)).toEqual(['1 source'])
    expect(traceMeta({ ...one, sources: [] })).toEqual(['0 sources'])
    const done = { ...agents.analyst, status: 'complete' as const, usage: { completion_tokens: 1234, cost: 0.0005 } }
    expect(traceMeta(done)).toEqual(['1,234 output tokens', '$0.000500'])
    expect(traceMeta({ ...done, usage: {} })).toEqual(['output tokens not reported', 'cost not reported'])
  })

  it('uses the sentence the server sent as the Retrieve trace detail', () => {
    const retriever = { ...createAgents().retriever, status: 'complete' as const, detail: 'Found 2 Wikipedia articles.' }
    expect(traceDetail(retriever)).toBe('Found 2 Wikipedia articles.')
  })
})

describe('derivePhase', () => {
  it('is complete from the four model stages alone, and Retrieve having no text does not hold it back', () => {
    const agents = createAgents()
    agents.retriever.status = 'complete'
    for (const role of ['researcher', 'analyst', 'critic', 'synthesizer'] as const) {
      agents[role].status = 'complete'
      agents[role].output = 'x'.repeat(60)
    }
    expect(derivePhase(agents, false, false)).toBe('complete')
  })

  it('is failed when Retrieve ran and no model stage produced text', () => {
    const agents = settleAgents({ ...createAgents(), retriever: { ...createAgents().retriever, status: 'complete' } }, false)
    expect(derivePhase(agents, false, false)).toBe('failed')
  })
})
