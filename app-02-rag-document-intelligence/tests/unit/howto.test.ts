import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HowTo } from '../../src/components/HowTo'
import { HOWTO_STEPS, HOWTO_WHAT, TRY_ARTICLE, TRY_QUESTION } from '../../src/lib/howto'
import { parseArxivId } from '../../src/lib/arxivId'

const render = (over: Partial<Parameters<typeof HowTo>[0]> = {}) =>
  renderToStaticMarkup(createElement(HowTo, { what: HOWTO_WHAT, steps: HOWTO_STEPS, onTry: () => undefined, disabled: false, hasResult: false, ...over }))

describe('the How to use block', () => {
  it('has an h2, an ordered list of 1 to 4 steps and a Try it button', () => {
    const html = render()
    expect(html).toContain('<h2')
    expect(html).toContain('How to use')
    expect(html.match(/<li>/g)?.length).toBe(HOWTO_STEPS.length)
    expect(HOWTO_STEPS.length).toBeGreaterThanOrEqual(1)
    expect(HOWTO_STEPS.length).toBeLessThanOrEqual(4)
    expect(html).toMatch(/<button[^>]*>Try it<\/button>/)
  })

  it('disables Try it while a run is live, and folds away once a result shows', () => {
    expect(render({ disabled: true })).toMatch(/<button[^>]*disabled=""[^>]*>Try it<\/button>/)
    const folded = render({ hasResult: true })
    expect(folded).not.toContain('Try it')
    expect(folded).toContain('aria-expanded="false"')
  })

  it('names controls that exist on screen', () => {
    const screen = ['QuestionSection', 'SourcePicker'].map(f => readFileSync(`src/components/${f}.tsx`, 'utf8')).join('\n')
    for (const label of ['Wikipedia', 'arXiv', 'Upload', 'Ask']) {
      expect(HOWTO_STEPS.join(' ')).toContain(label)
      expect(screen).toContain(label)
    }
  })
})

describe('Try it uses a live example, never a bundled file', () => {
  it('fetches a Wikipedia article by title and asks a real question', () => {
    expect(TRY_ARTICLE).toBe('Photosynthesis')
    expect(TRY_QUESTION.endsWith('?')).toBe(true)
    expect(readFileSync('src/App.tsx', 'utf8')).toContain("loader.load({ kind: 'wikipedia', title: TRY_ARTICLE })")
    expect(parseArxivId(TRY_ARTICLE)).toBeNull()
  })
})
