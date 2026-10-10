import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HowTo } from '../../src/components/HowTo'
import { HOWTO_STEPS, HOWTO_WHAT, TRY_ARTICLE } from '../../src/lib/howto'
import { extractUrl } from '../../src/lib/wikipedia'

const render = (over: Partial<Parameters<typeof HowTo>[0]> = {}) =>
  renderToStaticMarkup(createElement(HowTo, { what: HOWTO_WHAT, steps: HOWTO_STEPS, onTry: () => undefined, disabled: false, hasResult: false, ...over }))

describe('the How to use block', () => {
  it('has an h2, an ordered list of 1 to 4 steps and a Try it button', () => {
    const html = render()
    expect(html).toContain('<h2')
    expect(html).toContain('How to use')
    expect(html.match(/<li>/g)?.length).toBe(HOWTO_STEPS.length)
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
    const screen = readFileSync('src/components/InputPanel.tsx', 'utf8') + readFileSync('src/components/WikipediaLoader.tsx', 'utf8')
    for (const label of ['Wikipedia article', 'Document text', 'Analyze document']) {
      expect(HOWTO_STEPS.join(' ')).toContain(label)
      expect(screen).toContain(label)
    }
  })
})

describe('Try it fetches a live article and analyzes it', () => {
  it('asks Wikipedia for the example by title and runs the real analysis on its text', () => {
    expect(extractUrl(TRY_ARTICLE)).toContain('en.wikipedia.org')
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toContain('loadArticle(TRY_ARTICLE)')
    expect(app).toContain('await analyze(article.text)')
  })
})
