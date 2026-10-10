import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HowTo } from '../../src/components/HowTo'
import { EXAMPLES } from '../../src/components/Brief'
import { CONTENT_TYPES, MAX_TOPIC_CHARS } from '../../netlify/shared/contract'
import { HOWTO_STEPS, HOWTO_WHAT } from '../../src/lib/howto'

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
    const screen = ['Brief', 'Pipeline'].map(f => readFileSync(`src/components/${f}.tsx`, 'utf8')).join('\n')
    for (const label of ['Topic', 'Content type', 'Examples', 'Generate the piece', 'Pipeline']) {
      expect(HOWTO_STEPS.join(' ')).toContain(label)
      expect(screen).toContain(label)
    }
  })
})

describe('Try it runs the first example end to end', () => {
  it('uses a valid example brief and starts the real run with it', () => {
    const first = EXAMPLES[0]
    expect(first?.topic.length).toBeGreaterThan(0)
    expect(first?.topic.length).toBeLessThanOrEqual(MAX_TOPIC_CHARS)
    expect(CONTENT_TYPES).toContain(first?.type)
    expect(readFileSync('src/App.tsx', 'utf8')).toContain('void start(false, { topic: FIRST.topic, type: FIRST.type })')
  })
})
