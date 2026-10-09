import { describe, expect, it } from 'vitest'
import { FAITHFULNESS, extractMessages, synthesizeMessages } from '../../netlify/shared/prompts'

const system = (messages: Array<{ role: string; content: string }>): string => messages[0]?.content ?? ''

describe('faithfulness instruction', () => {
  it('tells the extract prompt to keep each actor and object and never reverse who does what to whom', () => {
    const prompt = system(extractMessages({ id: 1, text: 'Some text.' }, 1))

    expect(prompt).toContain(FAITHFULNESS.trim())
    expect(prompt).toContain('never reverse who does what to whom'.replace('never', 'Never'))
    expect(prompt).toContain('who is addressed or blamed')
  })

  it('asks synthesis for a short overview and short points, so the summary fits its output cap', () => {
    const prompt = system(synthesizeMessages({ byChunk: [], entities: [], findingCount: 0 }, [1], []))

    expect(prompt).toContain('overview under 40 words')
    expect(prompt).toContain('one sentence under 25 words')
  })

  it('tells the synthesis prompt the same', () => {
    const prompt = system(synthesizeMessages({ byChunk: [], entities: [], findingCount: 0 }, [1], []))

    expect(prompt).toContain(FAITHFULNESS.trim())
    expect(prompt).toContain('actor and object exactly as the text gives them')
  })
})
