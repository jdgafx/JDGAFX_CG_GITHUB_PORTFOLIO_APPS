import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HowTo } from '../../src/components/HowTo'
import { SAMPLES } from '../../src/components/PromptCard'
import { HOWTO_STEPS, HOWTO_WHAT } from '../../src/lib/howto'
import { blockedReason, DEFAULT_PICKS } from '../../src/lib/run'
import type { CatalogueResponse } from '../../netlify/shared/contract'

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

  it('names controls that exist on screen, and says Try it never votes', () => {
    const screen = ['PromptCard', 'RunActions', 'BlindAnswers'].map(f => readFileSync(`src/components/${f}.tsx`, 'utf8')).join('\n')
    for (const label of ['Sample prompts', 'Compare blind', 'is best', 'It is a tie']) {
      expect(HOWTO_STEPS.join(' ')).toContain(label)
      expect(screen).toContain(label)
    }
    expect(HOWTO_STEPS.join(' ')).toContain('never votes')
  })
})

describe('Try it compares blind and never votes', () => {
  it('starts a blind run on the first sample prompt and calls no vote', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    const handler = app.slice(app.indexOf('function handleTry'), app.indexOf('const voted'))
    expect(handler).toContain("mode: 'blind'")
    expect(handler).toContain('arena.start(')
    expect(handler).not.toMatch(/vote/i)
  })

  it('is allowed by the app\'s own checks once the model list has loaded', () => {
    const catalogue = { source: 'live', fetchedAt: null, defaultModel: DEFAULT_PICKS.B, groups: [{ label: 'g', options: [DEFAULT_PICKS.B, DEFAULT_PICKS.C].map(id => ({ id, label: id, why: '', inPerM: null, outPerM: null, contextLength: null })) }] } as CatalogueResponse
    expect(blockedReason(catalogue, DEFAULT_PICKS, SAMPLES[0].prompt)).toBeNull()
    expect(blockedReason(null, DEFAULT_PICKS, SAMPLES[0].prompt)).not.toBeNull()
  })
})
