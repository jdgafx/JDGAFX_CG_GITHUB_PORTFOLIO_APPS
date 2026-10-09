import { describe, expect, it } from 'vitest'
import { EXAMPLE_QUERIES, createAgents, hasUsefulOutput, slugifyQuery, statusView, wasTruncated } from '../../src/lib/agents'

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

  it('says Cut off for a finished stage whose reply stopped early', () => {
    expect(statusView({ ...base, status: 'complete', finish: 'length' })).toEqual({ word: 'Cut off', dot: 'ds-dot app-dot--warning' })
    expect(statusView({ ...base, status: 'error', finish: 'length' }).word).toBe('Failed')
  })
})

describe('stage output checks', () => {
  const base = createAgents().researcher

  it('counts output as useful from 40 trimmed characters', () => {
    expect(hasUsefulOutput({ ...base, output: 'a'.repeat(39) })).toBe(false)
    expect(hasUsefulOutput({ ...base, output: `  ${'a'.repeat(40)}  ` })).toBe(true)
  })

  it('marks a stage cut off for length, timeout, error or interrupted finishes only', () => {
    expect(wasTruncated({ ...base, finish: 'length' })).toBe(true)
    expect(wasTruncated({ ...base, finish: 'timeout' })).toBe(true)
    expect(wasTruncated({ ...base, finish: 'error' })).toBe(true)
    expect(wasTruncated({ ...base, finish: 'interrupted' })).toBe(true)
    expect(wasTruncated({ ...base, finish: 'stop' })).toBe(false)
    expect(wasTruncated({ ...base, finish: null })).toBe(false)
  })
})

describe('example questions', () => {
  it('offers three questions that fit the query limit', () => {
    expect(EXAMPLE_QUERIES).toHaveLength(3)
    expect(EXAMPLE_QUERIES.every(question => question.endsWith('?') && question.length <= 500)).toBe(true)
  })
})
