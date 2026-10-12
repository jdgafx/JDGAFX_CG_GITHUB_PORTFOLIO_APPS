import { describe, expect, it } from 'vitest'
import { MAX_BODY_BYTES, originAllowed, readText, validateExplainRequest } from '../../netlify/shared/boundary'
import { wireRequest } from './helpers'
import { decodeRequest } from '../../shared/modelInput'

/** What explain.ts does: decode the text, then validate. A decode failure is a refusal. */
function validate(wire: unknown) {
  try {
    return validateExplainRequest(decodeRequest(JSON.stringify(wire)))
  } catch {
    return { ok: false as const, message: 'not decodable' }
  }
}

const PROD = 'https://jdgafx-app-09-ai-saas.netlify.app'
const post = (url: string, origin?: string) =>
  new Request(url, { method: 'POST', headers: origin === undefined ? {} : { origin }, body: '{}' })

describe('origin check (C11)', () => {
  it('allows a request with no Origin header', () => {
    expect(originAllowed(post('https://site.test/api/explain'))).toBe(true)
  })
  it('allows the production origin', () => {
    expect(originAllowed(post('https://site.test/api/explain', PROD))).toBe(true)
  })
  it('allows the request\'s own origin, so a deploy preview works', () => {
    const preview = 'https://deploy-preview-28--jdgafx-app-09-ai-saas.netlify.app'
    expect(originAllowed(post(`${preview}/api/explain`, preview))).toBe(true)
  })
  it('refuses a cross-site origin, including a look-alike preview host (mutation check)', () => {
    const preview = 'https://deploy-preview-28--jdgafx-app-09-ai-saas.netlify.app'
    expect(originAllowed(post(`${preview}/api/explain`, 'https://evil.example'))).toBe(false)
    expect(originAllowed(post(`${preview}/api/explain`, 'https://deploy-preview-29--jdgafx-app-09-ai-saas.netlify.app'))).toBe(false)
    expect(originAllowed(post('https://site.test/api/explain', 'null'))).toBe(false)
  })
})

describe('body reading', () => {
  it('caps the body at 32 KB, by header and by measured bytes', async () => {
    expect(MAX_BODY_BYTES).toBe(32 * 1024)
    const big = JSON.stringify({ pad: 'x'.repeat(MAX_BODY_BYTES) })
    expect((await readText(new Request('https://site.test/x', { method: 'POST', body: big }))).ok).toBe(false)
    const declared = new Request('https://site.test/x', { method: 'POST', headers: { 'content-length': String(MAX_BODY_BYTES + 1) }, body: '{}' })
    expect((await readText(declared)).ok).toBe(false)
    expect(await readText(new Request('https://site.test/x', { method: 'POST', body: '{"a":1}' }))).toEqual({ ok: true, text: '{"a":1}' })
  })
})

function parse(mutate: (w: Record<string, any>) => void) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const w = wireRequest() as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  mutate(w)
  return validate(w)
}

describe('request validation', () => {
  it('accepts a valid decoded request, with bigint fields as real bigints', () => {
    const r = validate(wireRequest())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.request.facts[0]?.aggregates.windowTotal).toBe(5765986637n)
    expect(r.request.facts[0]?.aggregates.growth).toMatchObject({ S1: 412345678n, S0: 350000000n, n1: 30, computable: true })
    expect(r.request.target).toBe('react')
  })
  it('takes 1 to 4 names, the target among them in any position', () => {
    expect(parse((w) => { w.target = 'vite' }).ok).toBe(true)
    expect(parse((w) => { w.target = 'zod' }).ok).toBe(false)
    expect(parse((w) => { w.names = [] }).ok).toBe(false)
    expect(parse((w) => { w.names = ['react', 'vite', 'zod', 'esbuild', 'webpack'] }).ok).toBe(false)
    expect(parse((w) => { w.names = ['react', 'react'] }).ok).toBe(false)
    expect(parse((w) => { w.names = ['react', 'bad name!'] }).ok).toBe(false)
  })
  it('takes at most 60 rows per package, each an integer of 0 or more', () => {
    const row = (i: number) => [`2026-09-${String((i % 28) + 1).padStart(2, '0')}`, i, null]
    expect(parse((w) => { w.pastRows.react = Array.from({ length: 60 }, (_, i) => row(i)) }).ok).toBe(true)
    expect(parse((w) => { w.pastRows.react = Array.from({ length: 61 }, (_, i) => row(i)) }).ok).toBe(false)
    expect(parse((w) => { w.pastRows.react = [['2026-09-12', -1, null]] }).ok).toBe(false)
    expect(parse((w) => { w.pastRows.react = [['2026-09-12', 1.5, null]] }).ok).toBe(false)
    expect(parse((w) => { w.pastRows.react = [['2026-09-12', 5, 'other']] }).ok).toBe(false)
  })
  it('takes at most 6 unusual rows per package', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ day: `2026-02-${String(i + 1).padStart(2, '0')}`, value: 10, median: 5, kind: 'spike', release: 'none' }))
    expect(parse((w) => { w.facts[0].unusual = rows(6) }).ok).toBe(true)
    expect(parse((w) => { w.facts[0].unusual = rows(7) }).ok).toBe(false)
  })
  it('takes release state ok or failed only', () => {
    expect(parse((w) => { w.releaseState.vite = 'maybe' }).ok).toBe(false)
    expect(parse((w) => { delete w.releaseState.vite }).ok).toBe(false)
  })
  it('refuses malformed dates, windows and aggregates', () => {
    expect(parse((w) => { w.window.L = '11 Oct' }).ok).toBe(false)
    expect(parse((w) => { w.window.days = 60 }).ok).toBe(false)
    expect(parse((w) => { w.window.name = 'the past decade' }).ok).toBe(false)
    expect(parse((w) => { w.facts[0].aggregates.windowTotal = 12 }).ok).toBe(false)
    expect(parse((w) => { w.facts[0].aggregates.windowTotal = '-5' }).ok).toBe(false)
    expect(parse((w) => { w.facts[0].aggregates.windowTotal = '1.5' }).ok).toBe(false)
    expect(parse((w) => { w.facts[0].unusual[0].release = 3 }).ok).toBe(false)
    expect(parse((w) => { w.facts = [w.facts[1]] }).ok).toBe(false)
  })
  it('compares names as lower case: a differently-cased duplicate is refused', () => {
    expect(parse((w) => { w.names = ['react', 'React'] }).ok).toBe(false)
    expect(parse((w) => { w.names = ['react', '~vite'] }).ok).toBe(false)
    expect(parse((w) => { w.names = ['react', '-vite'] }).ok).toBe(false)
  })
  it('a name that is also an Object.prototype key is an ordinary name, and its missing rows are a refusal', () => {
    const named = (w: Record<string, any>, name: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      w.names = ['react', name]
      w.facts = [w.facts[0], { ...w.facts[1], name }]
      w.releaseState = { react: 'ok', [name]: 'ok' }
    }
    // the other Object.prototype names (valueOf, toString, hasOwnProperty, __proto__) are not valid lower-case names
    for (const name of ['valueOf', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(parse((w) => { w.names = ['react', name]; w.facts = [w.facts[0], { ...w.facts[1], name }]; w.releaseState = { react: 'ok', [name]: 'ok' } }).ok, name).toBe(false)
    }
    for (const name of ['constructor']) {
      // a peer with no rows of its own is fine: only the target's rows are required
      expect(parse((w) => named(w, name)).ok, `peer ${name}`).toBe(true)
      // the target without rows: refused, never read from the prototype
      const r = parse((w) => { named(w, name); w.target = name; w.pastRows = { react: w.pastRows.react } })
      expect(r.ok, `target ${name}`).toBe(false)
      const none = parse((w) => { named(w, name); w.target = name; delete w.pastRows })
      expect(none.ok, `target ${name}, pastRows omitted`).toBe(false)
      expect(none.ok ? '' : none.message).toBe('The target needs its rows.')
    }
  })
  it('a name that is an Object.prototype key gets its own release state, not the inherited member', () => {
    const r = parse((w) => {
      w.names = ['react', 'constructor']
      w.facts = [w.facts[0], { ...w.facts[1], name: 'constructor' }]
      w.releaseState = { react: 'ok' }
    })
    expect(r.ok).toBe(false)
  })
  it('growth marked computable needs both periods to have days and a positive earlier total', () => {
    expect(parse((w) => { w.facts[0].aggregates.growth.n0 = 0 }).ok).toBe(false)
    expect(parse((w) => { w.facts[0].aggregates.growth.n1 = 0 }).ok).toBe(false)
    expect(parse((w) => { w.facts[0].aggregates.growth.S0 = '0' }).ok).toBe(false)
    expect(parse((w) => { w.facts[1].aggregates.growth.n0 = 0 }).ok, 'a peer too').toBe(false)
    // not computable: zeros are the honest state
    expect(parse((w) => { Object.assign(w.facts[0].aggregates.growth, { computable: false, n0: 0, S0: '0' }) }).ok).toBe(true)
  })
  it('refuses a non-object body', () => {
    expect(validateExplainRequest(null).ok).toBe(false)
    expect(validateExplainRequest([]).ok).toBe(false)
    expect(validateExplainRequest('x').ok).toBe(false)
  })
})
