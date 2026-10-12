import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PanelResult } from '../../netlify/shared/contract'
import { ResultCard } from '../../src/components/ResultCard'

const SERVED = 'google/gemini-2.5-flash-lite'
const css = readFileSync('src/styles/app.css', 'utf8')
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('}', start))
}

describe('a served model id is shown in full', () => {
  it('renders the whole id in the panel name element', () => {
    const panel: PanelResult = {
      slot: 'B', requestedModel: SERVED, servedModel: SERVED, ok: true, error: null, text: 'READY', finishReason: 'stop',
      latencyMs: 300, usage: { prompt_tokens: 10, completion_tokens: 3, reasoning_tokens: null, total_tokens: 13 },
      cost: null, newestModel: SERVED, modelCheck: 'match',
    }
    const html = renderToStaticMarkup(createElement(ResultCard, { slot: 'B', requested: SERVED, panel, phase: 'done', fastest: false, cheapest: false, judgePick: false, scaleMs: 1000 }))
    expect(html).toContain('<span class="arena-name__model">gemini-2.5-flash-lite</span>')
  })

  it.each(['.arena-name__model', '.arena-row__name', '.arena-id'])('%s wraps instead of truncating', selector => {
    const body = rule(selector)
    expect(body).toContain('overflow-wrap: anywhere')
    expect(body).not.toMatch(/nowrap|ellipsis|overflow:\s*hidden/)
  })
})
