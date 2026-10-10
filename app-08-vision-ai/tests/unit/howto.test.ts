import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HowTo } from '../../src/components/HowTo'
import { buildSearchUrl } from '../../src/lib/commons'
import { HOWTO_STEPS, HOWTO_WHAT, TRY_PRESET } from '../../src/lib/howto'

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
    const screen = ['Hero', 'CommonsPicker', 'ActionDock'].map(f => readFileSync(`src/components/${f}.tsx`, 'utf8')).join('\n') + readFileSync('src/lib/modes.ts', 'utf8')
    for (const label of ['Choose file', 'Pick a public image', 'Describe', 'Analyze', 'Question', 'Extract', 'Analyze image']) {
      expect(HOWTO_STEPS.join(' ')).toContain(label)
      expect(screen).toContain(label)
    }
  })
})

describe('Try it uses a live Commons search, never a bundled picture', () => {
  it('searches Commons with a real preset and runs the describe path on the first result', () => {
    expect(TRY_PRESET?.query).toBe('busy city street crowd')
    expect(buildSearchUrl(TRY_PRESET?.query ?? '')).toContain('commons.wikimedia.org')
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toContain('searchCommons(TRY_PRESET.query)')
    expect(app).toContain('fetchCommonsFile(image)')
    expect(app).toContain("vision.changeMode('describe')")
  })
})
