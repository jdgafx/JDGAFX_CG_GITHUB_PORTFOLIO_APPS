import { describe, expect, it } from 'vitest'
import { MAX_TOKENS, NODE_MODEL, STEP_NEEDS_MS } from '../../netlify/shared/models'

describe('model assignment', () => {
  it('requests the Claude Haiku alias for every node, named by id once', () => {
    expect(NODE_MODEL).toBe('~anthropic/claude-haiku-latest')
  })

  it('caps each node reply and sends no temperature setting at all', async () => {
    expect(MAX_TOKENS).toEqual({ plan: 2000, agent: 2400, draft: 2800, critic: 2000 })
    const models = (await import('../../netlify/shared/models')) as Record<string, unknown>
    expect(Object.keys(models).filter((name) => name.includes('TEMPERATURE'))).toEqual([])
  })

  it('needs more time for a model step than for a Wikipedia round', () => {
    expect(STEP_NEEDS_MS.tools).toBeLessThan(STEP_NEEDS_MS.draft)
  })
})
