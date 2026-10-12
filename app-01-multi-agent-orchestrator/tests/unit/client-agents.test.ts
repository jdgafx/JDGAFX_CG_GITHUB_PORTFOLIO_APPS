import { describe, expect, it } from 'vitest'
import { EXAMPLE_QUERIES, createAgents, hasUsefulOutput, slugifyQuery, statusView } from '../../src/lib/agents'

describe('slugifyQuery', () => {
  it('makes a lowercase, dash-separated name from the first 40 characters', () => {
    expect(slugifyQuery('How is AI changing software engineering jobs?')).toBe('how-is-ai-changing-software-engineering')
  })

  it('trims dashes from the ends', () => {
    expect(slugifyQuery('  Nuclear power, realistic?! ')).toBe('nuclear-power-realistic')
  })

  it('falls back to a usable name when nothing is left', () => {
    expect(slugifyQuery('???')).toBe('untitled')
  })
})

describe('createAgents', () => {
  it('starts Retrieve and the four model stages idle, in pipeline order', () => {
    const agents = createAgents()
    expect(Object.keys(agents)).toEqual(['retriever', 'researcher', 'analyst', 'critic', 'synthesizer'])
    expect(agents.retriever).toMatchObject({ name: 'Retrieve', description: 'Fetches live sources', status: 'idle', maxTokens: 0 })
    expect(agents.researcher).toMatchObject({ name: 'Researcher', status: 'idle', output: '', detail: 'Waiting to start.' })
    expect(agents.synthesizer.name).toBe('Synthesizer')
  })
})

describe('statusView', () => {
  const base = createAgents().researcher

  it('gives one word and dot per status, shared by the graph, the tabs and the trace', () => {
    const words = (['idle', 'working', 'complete', 'error', 'skipped', 'stopped'] as const).map(status => statusView({ ...base, status }).word)
    expect(words).toEqual(['Waiting', 'Working', 'Finished', 'Failed', 'Not run', 'Stopped'])
    expect(statusView({ ...base, status: 'working' }).dot).toBe('ds-dot ds-dot--running')
    expect(statusView({ ...base, status: 'stopped' }).dot).toBe('ds-dot app-dot--warning')
  })

  it('has no "Cut off" status: the server ends the run on a cut-off reply, so a complete stage is always Finished', () => {
    expect(statusView({ ...base, status: 'complete', finish: 'length' }).word).toBe('Finished')
    expect(statusView({ ...base, status: 'error', finish: 'length' }).word).toBe('Failed')
  })
})

describe('stage output checks', () => {
  const base = createAgents().researcher

  it('counts output as useful from 40 trimmed characters', () => {
    expect(hasUsefulOutput({ ...base, output: 'a'.repeat(39) })).toBe(false)
    expect(hasUsefulOutput({ ...base, output: `  ${'a'.repeat(40)}  ` })).toBe(true)
  })
})

describe('example questions', () => {
  it('offers three questions that fit the query limit', () => {
    expect(EXAMPLE_QUERIES).toHaveLength(3)
    expect(EXAMPLE_QUERIES.every(question => question.endsWith('?') && question.length <= 500)).toBe(true)
  })
})
