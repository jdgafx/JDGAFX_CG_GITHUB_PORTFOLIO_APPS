import { describe, expect, it } from 'vitest'
import { MAX_BODY_BYTES, originAllowed, parseParagraph, readText, validateExplainRequest } from '../../netlify/shared/boundary'
import type { Segment } from '../../shared/types'
import captured from '../fixtures/sp2-e2ed80c-paragraphs.json'
import { wireRequest } from './helpers'
import { asSentences } from './sentences'
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

type Claim = Extract<Segment, { t: 'claim' }>
const text = (s: string): Segment => ({ t: 'text', s })
const claim = (kind: Claim['kind'], pkg: string, value: string, over: Partial<Claim> = {}): Segment => ({ t: 'claim', kind, package: pkg, span: 'window', day: '', value, ...over })
const cmp = (pkg: string, peer: string, metric: 'window_total' | 'last30_total' = 'window_total'): Segment => ({ t: 'compare', package: pkg, peer, metric })
const NAMES = ['vite', 'webpack', 'esbuild']
/** The model's answer: a list of sentences, each its own segments (rev 8.5). */
const tidy = (sentences: Segment[][], target = 'vite') => parseParagraph({ paragraph: sentences.map((sentence) => ({ sentence })) }, NAMES, target)
const total = claim('window_total', 'vite', '837275395')
const S1 = [text('Vite had '), total, text(' downloads.')]
const S2 = [text('Its peak was '), claim('peak_value', 'vite', '5'), text('.')]

describe('parseParagraph (rev 8.5): the paragraph is whole sentences; a sentence with any failed figure goes whole', () => {
  it('keeps whole sentences in order, one space between them, the text inside byte for byte', () => {
    expect(tidy([S1, S2])).toEqual([...S1, text(' '), ...S2])
    expect(tidy([[text('  Vite had '), total, text(' downloads.  ')]])).toEqual([text('Vite had '), total, text(' downloads.')])
  })
  it('the sentence of a figure about another package goes whole: no half sentence, no floating figure', () => {
    const other = claim('unusual_day', 'webpack', '2026-03-26')
    const out = tidy([S1, [text('On '), other, text(', downloads were a spike.')], S2])
    expect(out).toEqual([...S1, text(' '), ...S2])
    // the kept figure of the same sentence goes too: it has no sentence left to stand in
    const n = claim('day_value', 'vite', '29696229', { day: '2026-03-26' })
    expect(tidy([S1, [text('On '), other, text(', '), n, text(' downloads were a spike.')], S2])).toEqual([...S1, text(' '), ...S2])
  })
  it('a sentence that states a figure already stated goes whole; the first stays, whatever value or span the later one carries', () => {
    expect(tidy([S1, [text('Again, '), claim('window_total', 'vite', '1', { span: 'none' }), text(' downloads in all.')], S2])).toEqual([...S1, text(' '), ...S2])
    // a figure stated twice inside one sentence: the sentence goes
    expect(tidy([[text('Peak '), claim('peak_value', 'vite', '5'), text(' and '), claim('peak_value', 'vite', '6'), text('.')]])).toBeNull()
    // a dropped sentence does not mark its figures as stated: they may appear in a later sentence
    const d = claim('day_value', 'vite', '438449', { span: 'none', day: '2026-09-26' })
    expect(tidy([[text('On that day '), d, text(' downloads and '), claim('window_total', 'webpack', '1'), text(' for webpack.')], [text('On that day '), d, text(' downloads.')]])).toEqual([text('On that day '), d, text(' downloads.')])
  })
  it('keeps a compare that names the target as package or as peer; a sentence with a compare naming neither, or a repeat, goes', () => {
    const out = tidy([[cmp('vite', 'webpack')], [cmp('webpack', 'vite')], [text('Next: '), cmp('webpack', 'esbuild'), text('.')], [cmp('vite', 'webpack')], S2])
    expect(out).toEqual([cmp('vite', 'webpack'), text(' '), cmp('webpack', 'vite'), text(' '), ...S2])
  })
  it('a sentence with no words of its own, or that does not end whole, goes (a bare figure, "Peak 5", a hanging "On")', () => {
    expect(tidy([[claim('peak_value', 'vite', '5')], [text(' '), claim('peak_value', 'vite', '5'), text(' ')]])).toBeNull()
    expect(tidy([S1, [text('Peak '), claim('peak_value', 'vite', '5')]])).toEqual(S1) // ends on a figure
    expect(tidy([S1, [text('On '), claim('day', 'vite', '2026-03-26'), text(' downloads rose')]])).toEqual(S1) // no stop
    expect(tidy([S1, [text('Is it flat?')]])).toEqual([...S1, text(' '), text('Is it flat?')])
    expect(tidy([[text('Vite rose '), claim('change_pct', 'vite', ''), text('.')], [text('Compared with webpack: '), cmp('vite', 'webpack')]])).toHaveLength(6)
  })
  it('a figure that runs into a new sentence with no stop between goes whole (production run 2: "... of 2,603,987 The data does not show a cause")', () => {
    const runOn = [text('Vite had an unusual drop on '), claim('unusual_day', 'vite', '2025-12-25'), text(' with downloads of '), claim('day_value', 'vite', '2603987', { day: '2025-12-25' }), text(' The data does not show a cause for this drop.')]
    expect(tidy([S1, runOn, S2])).toEqual([...S1, text(' '), ...S2])
    // a lower-case continuation after a figure is one sentence
    const ok = [text('Vite had '), total, text(' downloads, and Webpack fewer.')]
    expect(tidy([ok])).toEqual(ok.map((x, i) => (i === 2 ? text(' downloads, and Webpack fewer.') : x)))
  })
  it('the stop may be followed by a closing quote or bracket, and a figure may sit before the first words', () => {
    const q = [claim('peak_value', 'vite', '5'), text(' downloads was the peak (a record).')]
    expect(tidy([q])).toEqual(q)
  })
  it('drops empty text segments inside a sentence and nothing else of it', () => {
    expect(tidy([[text(''), text('Vite had '), text(''), total, text(' downloads.'), text('')]])).toEqual(S1)
  })
  it('accepts a window_days claim and still refuses an unknown kind or package, or a sentence that is not a list', () => {
    const ok = [text('Over the last '), claim('window_days', 'vite', '30', { span: 'last30' }), text(' days it rose.')]
    expect(tidy([ok])).toEqual(ok)
    expect(tidy([[claim('window_total', 'react', '1')]])).toBeNull()
    expect(tidy([[{ t: 'claim', kind: 'nope', package: 'vite', span: 'window', day: '', value: '1' } as unknown as Segment]])).toBeNull()
    expect(parseParagraph({ paragraph: [S1] }, NAMES, 'vite')).toBeNull() // the old flat shape: a segment where a sentence belongs
    expect(parseParagraph({ paragraph: [{ sentence: 'x' }] }, NAMES, 'vite')).toBeNull()
    expect(parseParagraph({ paragraph: [] }, NAMES, 'vite')).toBeNull()
  })

  describe('the 36 paragraphs the SP2 verifier captured (e2ed80c), cut into sentences at their stops (tests/netlify/sentences.ts)', () => {
    const all = captured as Array<{ run: string; target: string; names: string[]; paragraph: Segment[] }>
    const cleaned = all.map((c) => ({ ...c, out: parseParagraph({ paragraph: asSentences(c.paragraph) }, c.names, c.target) }))
    it('there are 36, and the ones that still show something show no floating figure, foreign figure or repeat', () => {
      expect(all).toHaveLength(36)
      for (const { run, target, out } of cleaned) {
        if (out === null) continue
        const seen = new Set<string>()
        out.forEach((seg, i) => {
          if (seg.t === 'text') return
          expect(seg.t === 'compare' ? seg.package === target || seg.peer === target : seg.package === target, `${run} ${target} #${i}`).toBe(true)
          const key = JSON.stringify(seg.t === 'compare' ? [seg.package, seg.peer, seg.metric] : [seg.kind, seg.package, seg.kind === 'day_value' ? seg.day : seg.kind === 'unusual_day' || seg.kind === 'day' ? seg.value : seg.kind.startsWith('window_') ? String(seg.span === 'last30') : ''])
          expect(seen.has(key), `${run} ${target} #${i} repeats ${key}`).toBe(false)
          seen.add(key)
        })
        // every sentence ends whole: the paragraph ends on a stop or a compare
        const last = out[out.length - 1]!
        expect(last.t === 'compare' || (last.t === 'text' && /[.!?]\s*$/.test(last.s)), `${run} ${target}`).toBe(true)
      }
    })
    it('most captured paragraphs survive whole sentences (the rule does not empty the page)', () => {
      expect(cleaned.filter((c) => c.out !== null).length).toBeGreaterThanOrEqual(30)
    })
  })
})
