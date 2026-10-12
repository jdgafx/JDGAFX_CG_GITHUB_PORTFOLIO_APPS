import { describe, expect, it } from 'vitest'
import { createAgents, foundNoSources, statusView } from '../../src/lib/agents'
import { liveDataView } from '../../src/lib/liveData'
import { derivePhase, retryLine, settleAgents, traceDetail, traceMeta } from '../../src/lib/pipeline'

describe('retryLine', () => {
  it('names why a stage was tried a second time, and says nothing when it ran once', () => {
    expect(retryLine('timeout')).toEqual(['Retried once after a timeout'])
    expect(retryLine('connection')).toEqual(['Retried once after a dropped connection'])
    expect(retryLine('reply')).toEqual(['Retried once after an empty or cut-off reply'])
    expect(retryLine(undefined)).toEqual([])
  })

  it('leads the figures on a finished model line', () => {
    const done = { ...createAgents().analyst, status: 'complete' as const, retried: 'timeout', usage: { completion_tokens: 12, cost: 0.00001 } }
    expect(traceMeta(done)).toEqual(['Retried once after a timeout', '12 output tokens', '$0.000010'])
  })
})

describe('a failed model stage still shows what it was billed', () => {
  const failed = { ...createAgents().analyst, status: 'error' as const, error: 'Analyst ran out of reply length before it finished, so the run was stopped. Try again.' }

  it('shows the tokens and cost the provider billed for the cut-off reply', () => {
    expect(traceMeta({ ...failed, usage: { completion_tokens: 4000, cost: 0.001 } })).toEqual(['4,000 output tokens', '$0.001000'])
  })

  it('shows "not reported" when no usage arrived, and nothing for the retriever or a stage never called', () => {
    expect(traceMeta({ ...failed, usage: {} })).toEqual(['output tokens not reported', 'cost not reported'])
    expect(traceMeta({ ...createAgents().retriever, status: 'error' as const })).toEqual([])
    expect(traceMeta({ ...failed, status: 'skipped' as const })).toEqual([])
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

describe('a failed Retrieve', () => {
  it('ends in the Failed state with the Live data unavailable chip and the four stages not run', () => {
    const agents = createAgents()
    agents.retriever = { ...agents.retriever, status: 'error', error: 'Live data unavailable, so no report was written.', detail: 'x', ms: 900 }
    const settled = settleAgents(agents, false)
    expect(derivePhase(settled, false, false)).toBe('failed')
    expect(['researcher', 'analyst', 'critic', 'synthesizer'].map(role => settled[role as 'critic'].status)).toEqual(['skipped', 'skipped', 'skipped', 'skipped'])
    expect(liveDataView(settled.retriever, null)).toMatchObject({ state: 'failed', text: 'Live data unavailable: Wikipedia + Hacker News' })
    expect(statusView(settled.retriever).word).toBe('Failed')
  })
})
