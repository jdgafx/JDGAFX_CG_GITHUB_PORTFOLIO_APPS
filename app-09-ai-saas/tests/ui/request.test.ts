import { describe, expect, it } from 'vitest'
import { computeFacts } from '../../shared/aggregates'
import { buildPastRows, decodeRequest, encodeRequest } from '../../shared/modelInput'
import { topUnusual } from '../../shared/unusual'
import { computeWindow } from '../../shared/window'
import { figureNumbers, judge, validateShape } from '../../shared/claims'
import { MAX_BODY_BYTES, validateExplainRequest } from '../../netlify/shared/boundary'
import { buildRequest, derive, type Core } from '../../src/lib/useRun'
import { NPM_ROWS, RELEASES, RUN_DATE } from './helpers'

const core: Core = { computeWindow, computeFacts, judge, topUnusual, buildPastRows, figureNumbers, validateShape }

/** The browser's real request, through the shared encoder, the function's decoder and its boundary check. */
function requestsFor(names: string[], days: 30 | 90 | 365) {
  const downloads = Object.fromEntries(names.map(n => [n, { status: 'ok' as const, rows: NPM_ROWS[n]! }]))
  const releases = Object.fromEntries(names.map(n => [n, { status: 'ok' as const, releases: RELEASES[n]! }]))
  const snap = derive(core, names, days, RUN_DATE, downloads, releases)
  expect(snap.error).toBeNull()
  return names.map(target => buildRequest(core, snap, target))
}

describe('the browser request against the function boundary', () => {
  for (const [names, days] of [
    [['vite', 'webpack', 'esbuild'], 30],
    [['vite', 'webpack', 'esbuild'], 365],
  ] as const) {
    it(`${names.length} packages at ${days} days is accepted and under the body limit`, () => {
      for (const req of requestsFor([...names], days)) {
        const text = encodeRequest(req)
        expect(text.length).toBeLessThan(MAX_BODY_BYTES)
        const checked = validateExplainRequest(decodeRequest(text))
        expect(checked.ok ? 'ok' : checked.message).toBe('ok')
        expect(req.names[0]).toBe(req.target)
      }
    })
  }
})
