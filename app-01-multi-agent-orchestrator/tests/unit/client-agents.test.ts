import { describe, expect, it } from 'vitest'
import { createAgents, hasUsefulOutput, slugifyQuery, wasTruncated } from '../../src/lib/agents'

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
  it('starts all four stages idle, in pipeline order', () => {
    const agents = createAgents()
    expect(Object.keys(agents)).toEqual(['researcher', 'analyst', 'critic', 'synthesizer'])
    expect(agents.researcher).toMatchObject({ name: 'Researcher', status: 'idle', output: '', detail: 'Waiting to start.' })
    expect(agents.synthesizer.name).toBe('Synthesizer')
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
