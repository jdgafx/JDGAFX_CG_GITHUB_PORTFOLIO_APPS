import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RelayTrack } from '../../src/components/RelayTrack'
import { createAgents } from '../../src/lib/agents'
import { buildSteps } from '../../src/lib/graphLayout'
import { stepsFolded } from '../../src/lib/howto'

const states = (html: string) => [...html.matchAll(/data-agent="(\w+)" data-state="(\w+)"/g)].map(m => `${m[1]}:${m[2]}`)

describe('relay track', () => {
  it('shows the four agents, with node n active exactly while stage n runs', () => {
    const agents = createAgents()
    agents.researcher = { ...agents.researcher, status: 'complete', ms: 2100 }
    agents.analyst = { ...agents.analyst, status: 'working' }
    const html = renderToStaticMarkup(createElement(RelayTrack, { steps: buildSteps(agents, { phase: 'idle' }) }))
    expect(states(html)).toEqual(['researcher:done', 'analyst:active', 'critic:idle', 'synthesizer:idle'])
    expect(html).toContain('Finished · 2.1 s')
  })
})

describe('the steps stay open while a replay plays', () => {
  it('folds How to use only for a result of the visitor, not for the replay', () => {
    expect(stepsFolded('ready', false)).toBe(false)
    expect(stepsFolded('running', true)).toBe(false)
    expect(stepsFolded('complete', true)).toBe(false)
    expect(stepsFolded('running', false)).toBe(true)
    expect(stepsFolded('complete', false)).toBe(true)
  })
})
