import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { priceCall } from '../../netlify/shared/cost'
import { ReadoutStrip, priceUse } from '../../src/components/ReadoutStrip'
import { TracePanel } from '../../src/components/TracePanel'
import { formatRate } from '../../src/lib/format'
import { metricsFor } from '../../src/lib/metrics'
import { initialView, type RunView } from '../../src/lib/view'
import type { TraceRow } from '../../src/types/frames'
import { recordedPrices, SERVED_MODEL } from '../helpers/prices'

const usage = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 }

/** An answered call row, priced the way the server prices it. */
function call(node: TraceRow['node'], servedModel: string | null, list = recordedPrices()): TraceRow {
  return { node, status: 'ok', ms: 5, detail: node === 'extract' ? 'chunk 1 of 1' : node, model: '~anthropic/claude-haiku-latest', servedModel, usage, ...priceCall(list, servedModel, usage) }
}

/** A finished run's view over these rows. */
function finished(rows: TraceRow[]): RunView {
  const metrics = metricsFor(rows, 5)
  const result = {
    summary: { overview: 'o', sections: [] },
    coverage: { covered: [1], missing: [], noPoints: [] },
    reviewFlags: [],
    entities: [],
    retries: 0,
    chunkCount: 1,
    findingCount: 1,
    keyPoints: [],
    notice: null,
    retryOutcome: 'none' as const,
    metrics,
  }
  return { ...initialView(), phase: 'done', rows, result }
}

const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')
const trio = (served: string | null, list = recordedPrices()): TraceRow[] => [call('extract', served, list), call('check', served, list), call('synthesize', served, list)]

describe('formatRate', () => {
  it('states the per-token price per 1M tokens', () => {
    expect(formatRate({ prompt: 0.0000001, completion: 0.0000005 })).toBe('$0.10 in, $0.50 out per 1M tokens')
    expect(formatRate({ prompt: 0.000015, completion: 0.000075 })).toBe('$15.00 in, $75.00 out per 1M tokens')
    expect(formatRate({ prompt: 0.00000001, completion: 0 })).toBe('$0.01 in, $0.00 out per 1M tokens')
  })
})

describe('priceUse', () => {
  it('lists each served model that priced a call, once, with its rate', () => {
    const rows = [call('extract', SERVED_MODEL), call('check', SERVED_MODEL), call('synthesize', 'anthropic/claude-haiku-4.5')]

    expect(priceUse(rows)).toEqual([
      { model: SERVED_MODEL, rate: { prompt: 0.0000001, completion: 0.0000005 } },
      { model: 'anthropic/claude-haiku-4.5', rate: { prompt: 0.000001, completion: 0.000005 } },
    ])
  })

  it('lists nothing for calls that had no price', () => {
    expect(priceUse(trio(null))).toEqual([])
    expect(priceUse(trio(SERVED_MODEL, new Map()))).toEqual([])
  })
})

describe('the readout when the served model is priced', () => {
  const html = text(renderToStaticMarkup(createElement(ReadoutStrip, { view: finished(trio(SERVED_MODEL)) })))

  it('shows the cost, says the price comes from OpenRouter, and names the served model id with its price', () => {
    expect(html).toContain('$0.000600')
    expect(html).toContain(`Price from OpenRouter for ${SERVED_MODEL}: $0.10 in, $0.50 out per 1M tokens`)
  })

  it('shows the tokens too', () => {
    expect(html).toContain('3,600')
  })
})

describe('the readout when the reply named no model', () => {
  const html = text(renderToStaticMarkup(createElement(ReadoutStrip, { view: finished(trio(null)) })))

  it('shows the tokens and says the served model was not reported, with no price', () => {
    expect(html).toContain('3,600')
    expect(html).toContain('Served model not reported, so no price')
    expect(html).toContain('No price')
    expect(html).not.toContain('$0.')
  })
})

describe('the readout when the model list could not be fetched', () => {
  const html = text(renderToStaticMarkup(createElement(ReadoutStrip, { view: finished(trio(SERVED_MODEL, new Map())) })))

  it('shows the tokens and says the price is unavailable, with no price', () => {
    expect(html).toContain('3,600')
    expect(html).toContain('Price unavailable')
    expect(html).toContain("OpenRouter's price list could not be read")
    expect(html).not.toContain('$0.')
  })
})

describe('the trace', () => {
  const trace = (rows: TraceRow[]): string => renderToStaticMarkup(createElement(TracePanel, { view: finished(rows) }))

  it('shows each row cost and, on hover, the OpenRouter price for the served model', () => {
    const html = trace([call('extract', SERVED_MODEL)])

    expect(text(html)).toContain('$0.000200')
    expect(html).toContain(`title="Price from OpenRouter for ${SERVED_MODEL}: $0.10 in, $0.50 out per 1M tokens"`)
  })

  it('shows tokens and "served model not reported" with no price for a reply without a model', () => {
    const shown = text(trace([call('extract', null)]))

    expect(shown).toContain('1,200 tok')
    expect(shown).toContain('no price')
    expect(shown).toContain('served model not reported')
    expect(shown).not.toContain('$0.')
  })

  it('shows tokens and "price unavailable" when the list could not be fetched', () => {
    const shown = text(trace([call('extract', SERVED_MODEL, new Map())]))

    expect(shown).toContain('1,200 tok')
    expect(shown).toContain('price unavailable')
    expect(shown).not.toContain('$0.')
  })
})
