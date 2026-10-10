import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HowTo } from '../../src/components/HowTo'
import { DATASET_CHOICES, DEFAULT_DATASET } from '../../src/lib/liveData/catalog'
import { HOWTO_STEPS, HOWTO_WHAT, TRY_QUESTION } from '../../src/lib/howto'

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
    const screen = ['DataSection', 'QueryBar', 'ThreadPanel'].map(f => readFileSync(`src/components/${f}.tsx`, 'utf8')).join('\n')
    for (const label of ['Dataset', 'Upload CSV', 'Your question', 'Plan and run', 'Ask a follow-up']) {
      expect(HOWTO_STEPS.join(' ')).toContain(label)
      expect(screen).toContain(label)
    }
    expect(HOWTO_STEPS.join(' ')).toContain(DATASET_CHOICES.find(d => d.id === DEFAULT_DATASET)?.label)
  })
})

describe('Try it runs the live feed with a question the dataset can answer', () => {
  it('uses the default USGS dataset and one of its own example questions', () => {
    expect(DEFAULT_DATASET).toBe('quakes-week')
    expect(DATASET_CHOICES.find(d => d.id === DEFAULT_DATASET)?.questions).toContain(TRY_QUESTION)
    expect(readFileSync('src/App.tsx', 'utf8')).toContain("ask(TRY_QUESTION, 'new')")
  })
})
