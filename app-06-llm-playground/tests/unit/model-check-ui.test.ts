import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { JudgeVerdict, PanelResult } from '../../netlify/shared/contract'
import { JudgeCard } from '../../src/components/JudgeCard'
import { ResultCard } from '../../src/components/ResultCard'
import { checkMarker } from '../../src/lib/run'

const ALIAS = '~anthropic/claude-haiku-latest'
const NEWEST = 'anthropic/claude-haiku-5.5'
const OLDER = 'anthropic/claude-haiku-5.4'

function panel(over: Partial<PanelResult> = {}): PanelResult {
  return {
    slot: 'A',
    requestedModel: ALIAS,
    servedModel: NEWEST,
    ok: true,
    error: null,
    text: 'READY',
    finishReason: 'stop',
    latencyMs: 300,
    usage: { prompt_tokens: 10, completion_tokens: 3, reasoning_tokens: null, total_tokens: 13 },
    cost: null,
    newestModel: NEWEST,
    modelCheck: 'match',
    ...over,
  }
}

function card(p: PanelResult | null, slot: 'A' | 'B' = 'A') {
  return renderToStaticMarkup(
    createElement(ResultCard, {
      slot,
      requested: slot === 'A' ? ALIAS : 'google/gemini-2.5-flash-lite',
      panel: p,
      phase: 'done',
      fastest: false,
      cheapest: false,
      judgePick: false,
      scaleMs: 300,
    }),
  )
}

// The name line of a panel: its title attribute and its text.
function nameLine(html: string): { title: string; text: string } {
  const match = /<p class="arena-name[^"]*" title="([^"]*)">(.*?)<\/p>/.exec(html)
  if (!match) throw new Error('no name line in the panel')
  return { title: match[1], text: match[2].replace(/<[^>]+>/g, '') }
}

function verdict(over: Partial<JudgeVerdict> = {}): JudgeVerdict {
  return {
    ok: true,
    model: OLDER,
    latencyMs: 400,
    bestOverall: 'B',
    perPanel: {},
    caveat: '',
    usage: { prompt_tokens: 1, completion_tokens: 1, reasoning_tokens: null, total_tokens: 2 },
    cost: null,
    trace: [],
    newestModel: NEWEST,
    modelCheck: 'mismatch',
    ...over,
  }
}

describe('checkMarker', () => {
  it('shows match as newest, with no title change', () => {
    expect(checkMarker('match', NEWEST)).toEqual({ label: '· newest', warn: false, titleSuffix: '' })
  })

  it('shows mismatch as not newest, in the warning look, with the newest id in the title', () => {
    expect(checkMarker('mismatch', NEWEST)).toEqual({ label: '· not newest', warn: true, titleSuffix: `, newest: ${NEWEST}` })
  })

  it('shows unchecked as unchecked', () => {
    expect(checkMarker('unchecked', null)).toEqual({ label: '· unchecked', warn: false, titleSuffix: '' })
  })

  it('shows nothing for not-reported, for a panel with no check, and for a missing check', () => {
    expect(checkMarker('not-reported', null)).toBeNull()
    expect(checkMarker(null, null)).toBeNull()
    expect(checkMarker(undefined, undefined)).toBeNull()
  })
})

describe('Panel A served-model readout', () => {
  it('shows the served id with the newest marker, and a title with only the served id', () => {
    const line = nameLine(card(panel()))
    expect(line.text).toContain('· newest')
    expect(line.title).toBe(NEWEST)
  })

  it('shows a served id that is not the newest with a warning marker, and the newest id in the title', () => {
    const html = card(panel({ servedModel: OLDER, modelCheck: 'mismatch' }))
    const line = nameLine(html)
    expect(line.text).toContain('· not newest')
    expect(line.title).toBe(`${OLDER}, newest: ${NEWEST}`)
    expect(html).toContain('class="ds-badge--warning"')
  })

  it('shows unchecked when the list gave no newest id', () => {
    const line = nameLine(card(panel({ newestModel: null, modelCheck: 'unchecked' })))
    expect(line.text).toContain('· unchecked')
    expect(line.title).toBe(NEWEST)
  })

  it('shows not reported with no marker when the reply named no model', () => {
    const line = nameLine(card(panel({ servedModel: null, modelCheck: 'not-reported' })))
    expect(line.text).toContain('served model not reported')
    expect(line.text).not.toMatch(/·/)
  })
})

describe('Panels B and C', () => {
  it('show the served id with no marker, because they are not checked', () => {
    const line = nameLine(card(panel({ slot: 'B', requestedModel: 'google/gemini-2.5-flash-lite', servedModel: 'google/gemini-2.5-flash-lite-001', newestModel: null, modelCheck: null }), 'B'))
    expect(line.text).toContain('gemini-2.5-flash-lite-001')
    expect(line.text).not.toMatch(/·/)
  })
})

describe('the judge line', () => {
  function judged(v: JudgeVerdict) {
    return renderToStaticMarkup(createElement(JudgeCard, { judge: { state: 'done', verdict: v }, compare: null }))
  }

  it('marks a judge model that is not the newest, with the newest id in the title', () => {
    const html = judged(verdict())
    expect(html).toContain('· not newest')
    expect(html).toContain(`title="${OLDER}, newest: ${NEWEST}"`)
    expect(html).toContain('class="ds-badge--warning"')
  })

  it('marks a judge model that is the newest, with no warning look', () => {
    const html = judged(verdict({ model: NEWEST, modelCheck: 'match' }))
    expect(html).toContain('· newest')
    expect(html).not.toContain('ds-badge--warning')
  })

  it('says a model was not reported, with no marker, when the judge reply named none', () => {
    const html = judged(verdict({ model: null, modelCheck: 'not-reported' }))
    expect(html).toContain('a model not reported')
    expect(html).not.toMatch(/· (newest|not newest|unchecked)/)
  })
})
