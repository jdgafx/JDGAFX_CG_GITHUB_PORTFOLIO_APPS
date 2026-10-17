import { describe, expect, it } from 'vitest'
import { MAX_BODY_BYTES, originAllowed, parseParagraph, readText, validateExplainRequest } from '../../netlify/shared/boundary'
import type { Segment } from '../../shared/types'
import captured from '../fixtures/sp2-e2ed80c-paragraphs.json'
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

type Claim = Extract<Segment, { t: 'claim' }>
const text = (s: string): Segment => ({ t: 'text', s })
const claim = (kind: Claim['kind'], pkg: string, value: string, over: Partial<Claim> = {}): Segment => ({ t: 'claim', kind, package: pkg, span: 'window', day: '', value, ...over })
const cmp = (pkg: string, peer: string, metric: 'window_total' | 'last30_total' = 'window_total'): Segment => ({ t: 'compare', package: pkg, peer, metric })
const NAMES = ['vite', 'webpack', 'esbuild']
const tidy = (paragraph: Segment[], target = 'vite') => parseParagraph({ paragraph }, NAMES, target)

describe('parseParagraph (rev 8.3): the paragraph shows each of the target\'s own figures once, with words around it', () => {
  it('drops a repeat of a claim, keeping the first, and the model\'s text byte for byte where no sentence is broken', () => {
    const out = tidy([text('Total '), claim('window_total', 'vite', '837275395'), text('. Again. '), claim('window_total', 'vite', '837275395')])
    expect(out).toEqual([text('Total '), claim('window_total', 'vite', '837275395'), text('. Again. ')])
  })
  it('a repeat that leaves "Again " with nothing after it takes that half sentence', () => {
    expect(tidy([text('Total '), claim('window_total', 'vite', '837275395'), text('. Again '), claim('window_total', 'vite', '837275395')])).toEqual([text('Total '), claim('window_total', 'vite', '837275395'), text('. ')])
  })
  it('a figure stated again with another value or span is still the same figure: the first stays (placeholders 1 and 0, span none)', () => {
    const peak = claim('peak_value', 'webpack', '12326693')
    expect(tidy([text('Peak '), peak, text(' downloads. '), claim('peak_value', 'webpack', '1', { span: 'none' }), text('')], 'webpack')).toEqual([text('Peak '), peak, text(' downloads. ')])
    const d = claim('day_value', 'vite', '438449', { span: 'none', day: '2026-09-26' })
    expect(tidy([text('On that day '), d, text(' downloads. '), claim('day_value', 'vite', '0', { span: 'none', day: '2026-09-26' }), text(' ')])).toEqual([text('On that day '), d, text(' downloads. '), text(' ')])
  })
  it('different figures are all kept: two totals of different spans, two unusual days, a day and its count', () => {
    const p = [
      text('Past year '), claim('window_total', 'vite', '5270117263'), text(' and past month '), claim('window_total', 'vite', '837275395', { span: 'last30' }),
      text(' on '), claim('unusual_day', 'vite', '2026-02-21'), text(' and '), claim('unusual_day', 'vite', '2026-02-22'), text(' with '), claim('day_value', 'vite', '6458089', { day: '2026-02-21' }),
    ]
    expect(tidy(p)).toEqual(p)
  })
  it('drops a figure claim about another package', () => {
    expect(tidy([text('Vite had '), claim('window_total', 'vite', '837275395'), text(' downloads. '), claim('window_total', 'webpack', '1')])).toEqual([text('Vite had '), claim('window_total', 'vite', '837275395'), text(' downloads. ')])
  })
  it('keeps a compare that names the target as package or as peer, drops one that names neither, and drops a repeated compare', () => {
    const p = [text('x. '), cmp('vite', 'webpack'), text('. '), cmp('webpack', 'vite'), text('. '), cmp('webpack', 'esbuild'), text('. '), cmp('vite', 'webpack'), text('.')]
    expect(tidy(p)).toEqual([text('x. '), cmp('vite', 'webpack'), text('. '), cmp('webpack', 'vite'), text('. '), text('. '), text('.')])
  })
  it('drops a claim with no words on either side (blank text, a compare or the paragraph edge) and keeps one with words on one side', () => {
    expect(tidy([text('Words. '), cmp('vite', 'webpack'), text(' '), claim('peak_value', 'vite', '5'), text(' '), cmp('vite', 'esbuild')])).toEqual([text('Words. '), cmp('vite', 'webpack'), text(' '), text(' '), cmp('vite', 'esbuild')])
    expect(tidy([text('Words. '), cmp('vite', 'webpack'), claim('peak_value', 'vite', '5')])).toEqual([text('Words. '), cmp('vite', 'webpack')])
    expect(tidy([text('Words '), claim('peak_value', 'vite', '5'), cmp('vite', 'webpack')])).toHaveLength(3) // words on one side: part of a sentence
    expect(tidy([claim('peak_value', 'vite', '5')])).toBeNull() // nothing else left
    const kept = [text('Peak '), claim('peak_day', 'vite', '2026-10-01'), claim('peak_value', 'vite', '39379494'), text(' downloads')]
    expect(tidy(kept)).toEqual(kept) // two claims side by side are one phrase
  })
  it('a dropped claim never leaves half a sentence: the sentence it sat in goes with it (the "Across the past year, is compared below." fragment)', () => {
    // a compare between two peers is dropped; its words around it would read "Across the past year,  is compared below."
    expect(tidy([text('Vite grew. Across the past year, '), cmp('webpack', 'esbuild'), text(' is compared below. Vite peaked on '), claim('peak_day', 'vite', '2026-10-01'), text('.')])).toEqual([
      text('Vite grew. '),
      text(' Vite peaked on '),
      claim('peak_day', 'vite', '2026-10-01'),
      text('.'),
    ])
    // a repeated claim in the middle of a sentence takes its whole sentence, kept claims included, and the paragraph ends on a whole sentence
    const first = claim('window_total', 'vite', '837275395')
    expect(tidy([text('Total '), first, text('. Again, over the year, '), claim('window_total', 'vite', '837275395'), text(' downloads in all. Peak '), claim('peak_value', 'vite', '5'), text('.')])).toEqual([
      text('Total '),
      first,
      text('. '),
      text(' Peak '),
      claim('peak_value', 'vite', '5'),
      text('.'),
    ])
    // the whole paragraph is one broken sentence: nothing whole is left, so nothing is shown
    expect(tidy([text('Across the past year, '), cmp('webpack', 'esbuild'), text(' is compared below')])).toBeNull()
    // a drop with no words of its own sentence around it changes nothing
    expect(tidy([text('Done. '), claim('window_total', 'webpack', '1'), text('. Next.')])).toEqual([text('Done. '), text('. Next.')])
  })
  it('drops empty text segments and nothing else of the text', () => {
    expect(tidy([text(''), text(' '), text('a'), text('')])).toEqual([text(' '), text('a')])
  })
  it('accepts a window_days claim and still refuses an unknown kind or package', () => {
    const ok = [text('Over the last '), claim('window_days', 'vite', '30', { span: 'last30' }), text(' days.')]
    expect(tidy(ok)).toEqual(ok)
    expect(parseParagraph({ paragraph: [claim('window_total', 'react', '1')] }, NAMES, 'vite')).toBeNull()
    expect(parseParagraph({ paragraph: [{ t: 'claim', kind: 'nope', package: 'vite', span: 'window', day: '', value: '1' }] }, NAMES, 'vite')).toBeNull()
  })

  describe('the 36 paragraphs the SP2 verifier captured (e2ed80c)', () => {
    const all = captured as Array<{ run: string; target: string; names: string[]; paragraph: Segment[] }>
    const figureKey = (c: Claim): string => `${c.kind}|${c.package}|${c.kind === 'day_value' ? c.day : c.kind === 'unusual_day' || c.kind === 'day' ? c.value : c.kind === 'window_total' || c.kind === 'window_days' ? String(c.span === 'last30') : ''}`
    const cleaned = all.map((c) => ({ ...c, out: parseParagraph({ paragraph: c.paragraph }, c.names, c.target)! }))
    it('every one still parses', () => {
      expect(all).toHaveLength(36)
      for (const c of cleaned) expect(c.out, c.run + c.target).not.toBeNull()
    })
    it('none shows a claim about another package, a repeat or a stray claim with no words around it', () => {
      for (const { run, target, out } of cleaned) {
        const seen = new Set<string>()
        out.forEach((seg, i) => {
          if (seg.t === 'text') return expect(seg.s, `${run} ${target}`).not.toBe('')
          const about = seg.t === 'compare' ? seg.package === target || seg.peer === target : seg.package === target
          expect(about, `${run} ${target} #${i}`).toBe(true)
          const key = seg.t === 'compare' ? `${seg.package}|${seg.peer}|${seg.metric}` : figureKey(seg)
          expect(seen.has(key), `${run} ${target} #${i} repeats ${key}`).toBe(false)
          seen.add(key)
          if (seg.t === 'claim') {
            const around = (s: Segment | undefined) => s?.t === 'claim' || (s?.t === 'text' && s.s.trim() !== '')
            expect(around(out[i - 1]) || around(out[i + 1]), `${run} ${target} #${i} has no words around it`).toBe(true)
          }
        })
      }
    })
    it('removes exactly the stray claims (19 in 16 paragraphs); the text is byte for byte except in a paragraph where a dropped claim broke a sentence', () => {
      let dropped = 0
      let changed = 0
      const cut: string[] = []
      const words = (segs: Segment[]) => segs.filter((s) => s.t === 'text' && s.s !== '').map((s) => (s as { s: string }).s).join('|')
      for (const { run, target, paragraph, out } of cleaned) {
        const before = paragraph.filter((s) => s.t !== 'text').length
        const after = out.filter((s) => s.t !== 'text').length
        dropped += before - after
        if (before !== after) changed += 1
        if (words(out) === words(paragraph)) continue
        cut.push(`${run} ${target}`)
        // what is left is the model's own text up to a stop, never a half sentence
        expect(words(paragraph).startsWith(words(out).replace(/\s+$/, '').replace(/\|$/, '')), `${run} ${target}`).toBe(true)
        expect(words(out), `${run} ${target}`).toMatch(/[.!?]\s*$/)
      }
      expect({ dropped, changed }).toEqual({ dropped: 19, changed: 16 })
      // the one captured paragraph that read "<dropped claim> is the only spike cited here."
      expect(cut).toEqual(['item8-390-dark-run drizzle-orm'])
    })
  })
})
