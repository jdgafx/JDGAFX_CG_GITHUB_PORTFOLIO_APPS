import { describe, expect, it } from 'vitest'
import { AGENTS, MIN_STAGE_MS, RUN_BUDGET_MS, keyLine, trimCtx } from '../../netlify/shared/agents'

describe('stage definitions', () => {
  it('runs four stages in order, each with an explicit token ceiling and a time cap', () => {
    expect(AGENTS.map(agent => agent.role)).toEqual(['researcher', 'analyst', 'critic', 'synthesizer'])
    expect(AGENTS.map(agent => agent.maxTokens)).toEqual([600, 600, 400, 1200])
    expect(AGENTS.map(agent => agent.timeoutMs)).toEqual([5500, 5500, 4500, 10000])
  })

  it('keeps the run budget inside the 60 s function limit and every stage cap inside the budget', () => {
    expect(RUN_BUDGET_MS).toBe(24_000)
    expect(RUN_BUDGET_MS).toBeLessThan(60_000)
    expect(MIN_STAGE_MS).toBe(2_000)
    for (const agent of AGENTS) expect(agent.timeoutMs).toBeLessThan(RUN_BUDGET_MS)
  })

  it('builds each stage message from the query and the earlier outputs', () => {
    const [researcher, analyst, critic, synthesizer] = AGENTS
    expect(researcher?.buildUserMessage('Q', {})).toBe('Research: Q\n\n3-5 bullet points only. Be extremely concise.')
    expect(analyst?.buildUserMessage('Q', { researcher: 'Facts' })).toBe(
      'Analyze:\nFacts\n\n2-3 key patterns only. Extremely concise.',
    )
    expect(critic?.buildUserMessage('Q', {})).toBe(
      'Review:\n(no output from the previous agent)\n\n2-3 gaps only. Very brief.',
    )
    expect(synthesizer?.buildUserMessage('Q', { researcher: 'R', analyst: 'A', critic: 'C' })).toBe(
      'Final report on "Q".\n\nResearch:\nR\n\nAnalysis:\nA\n\nGaps:\nC',
    )
  })

  it('tells the synthesizer to honour a length or format the question sets', () => {
    const prompt = AGENTS[3]?.systemPrompt ?? ''
    expect(prompt).toContain('"in two sentences"')
    expect(prompt).toContain('follow it exactly')
    expect(prompt).toContain('Otherwise aim for 200-300 words.')
  })

  it('keeps the word limit on every early stage', () => {
    expect(AGENTS[0]?.systemPrompt).toContain('STRICT LIMIT: 150 words max.')
    expect(AGENTS[1]?.systemPrompt).toContain('STRICT LIMIT: 150 words max.')
    expect(AGENTS[2]?.systemPrompt).toContain('STRICT LIMIT: 100 words max.')
  })
})

describe('trimCtx', () => {
  it('marks a missing earlier output and cuts long ones at 800 characters', () => {
    expect(trimCtx(undefined)).toBe('(no output from the previous agent)')
    expect(trimCtx('   ')).toBe('(no output from the previous agent)')
    expect(trimCtx('a'.repeat(900))).toBe(`${'a'.repeat(800)}\n[trimmed]`)
    expect(trimCtx(' short ')).toBe('short')
  })
})

describe('keyLine', () => {
  it('returns the first real line without markdown markers', () => {
    expect(keyLine('\n## **Key** finding: fast\nsecond line')).toBe('Key finding: fast')
    expect(keyLine('1. First point')).toBe('First point')
    expect(keyLine('- **Gap**: none')).toBe('Gap: none')
  })

  it('cuts a long line at a word boundary and ends it with an ellipsis', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
    const cut = keyLine(words)
    expect(cut.length).toBeLessThanOrEqual(141)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut.slice(0, -1).endsWith(' ')).toBe(false)
    expect(words.startsWith(cut.slice(0, -1))).toBe(true)
    expect(cut.slice(0, -1).split(' ').every(word => /^word\d+$/.test(word))).toBe(true)
  })

  it('leaves a short line untouched', () => {
    expect(keyLine('short line')).toBe('short line')
  })

  it('caps an unbroken line at 140 characters plus an ellipsis and returns nothing for blank text', () => {
    const cut = keyLine('x'.repeat(200))
    expect(cut).toHaveLength(141)
    expect(cut.endsWith('…')).toBe(true)
    expect(keyLine('   ')).toBe('')
  })
})
