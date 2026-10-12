import { describe, expect, it } from 'vitest'
import { HANDOFF_MAX_AGE_MS, makeHandoff, openHandoff, sealOf, textHash } from '../../netlify/shared/handoff'
import { validateSynthesizeBody } from '../../netlify/shared/guard'
import { mergeFindings } from '../../netlify/shared/merge'
import type { Finding, Merged } from '../../src/types/frames'

const KEY = 'test-only-placeholder'
const OTHER_KEY = 'another-test-only-placeholder'

const paragraph = (n: number): string => Array.from({ length: 120 }, (_, i) => `term${n}w${i}`).join(' ') + '.'
const TEXT = [1, 2, 3].map(paragraph).join('\n')
const finding = (chunkId: number, points: string[], entities: string[] = []): Finding => ({ chunkId, points, entities, model: null, usage: null })
const merged = (): Merged => mergeFindings([finding(1, ['Rule one.', 'Detail one.'], ['Lessor']), finding(2, ['Rule two.']), finding(3, ['Rule three.'])])

/** What request 1 hands the browser, and what the browser posts back. */
const handoff = () => makeHandoff(KEY, TEXT, merged())
const post = (h: unknown, text: unknown = TEXT) => validateSynthesizeBody({ text, handoff: h }, KEY)

describe('a seal expires after 5 minutes', () => {
  const ISSUED = 1_700_000_000_000
  const old = () => makeHandoff(KEY, TEXT, merged(), ISSUED)

  it('opens a seal up to 5 minutes old, and refuses one that is older, with no model call', () => {
    expect(HANDOFF_MAX_AGE_MS).toBe(5 * 60_000)
    expect(openHandoff(KEY, TEXT, old(), ISSUED + HANDOFF_MAX_AGE_MS)).toEqual(merged())
    expect(openHandoff(KEY, TEXT, old(), ISSUED + HANDOFF_MAX_AGE_MS + 1)).toBeNull()
    const checked = validateSynthesizeBody({ text: TEXT, handoff: old() }, KEY, ISSUED + HANDOFF_MAX_AGE_MS + 1)
    expect(checked).toMatchObject({ ok: false, status: 400 })
    if (!checked.ok) expect(checked.error).toMatch(/key points/i)
  })

  it('refuses a seal dated in the future by more than a minute, and one whose date was changed', () => {
    expect(openHandoff(KEY, TEXT, old(), ISSUED - 61_000)).toBeNull()
    expect(openHandoff(KEY, TEXT, old(), ISSUED - 30_000)).toEqual(merged())
    // Moving the date forward keeps the old seal, which no longer fits.
    const h = old()
    const body = JSON.parse(h.text) as { at: number }
    body.at = ISSUED + 10 * 60_000
    expect(openHandoff(KEY, TEXT, { text: JSON.stringify(body), seal: h.seal }, ISSUED + 10 * 60_000)).toBeNull()
  })

  it('refuses a signed hand-off that carries no date', () => {
    const body = JSON.parse(old().text) as Record<string, unknown>
    delete body.at
    const text = JSON.stringify(body)
    expect(openHandoff(KEY, TEXT, { text, seal: sealOf(KEY, text) }, ISSUED)).toBeNull()
  })
})

describe('the hand-off is signed by request 1 and opened by request 2', () => {
  it('opens an untouched hand-off for the text it was made for', () => {
    expect(openHandoff(KEY, TEXT, handoff())).toEqual(merged())
    const checked = post(handoff())
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.resume.merged).toEqual(merged())
  })

  it('hashes the exact text', () => {
    expect(textHash(TEXT)).toMatch(/^[0-9a-f]{64}$/)
    expect(textHash(TEXT)).not.toBe(textHash(`${TEXT} `))
  })

  it('refuses invented key points: a hand-off whose points were changed keeps the old seal and fails it', () => {
    const h = handoff()
    const body = JSON.parse(h.text) as { merged: Merged }
    body.merged.byChunk[0]!.points[0]!.text = 'The lease is void.'
    const checked = post({ text: JSON.stringify(body), seal: h.seal })

    expect(checked).toMatchObject({ ok: false, status: 400 })
    if (!checked.ok) expect(checked.error).toMatch(/key points/i)
  })

  it('refuses a point added to a chunk, a chunk dropped, and an invented chunk, all under the old seal', () => {
    for (const change of [
      (m: Merged) => void m.byChunk[1]!.points.push({ id: '2.2', text: 'Invented.' }),
      (m: Merged) => void m.byChunk.pop(),
      (m: Merged) => void m.byChunk.push({ chunkId: 4, points: [{ id: '4.1', text: 'Invented.' }], entities: [] }),
    ]) {
      const h = handoff()
      const body = JSON.parse(h.text) as { merged: Merged }
      change(body.merged)
      expect(post({ text: JSON.stringify(body), seal: h.seal })).toMatchObject({ ok: false, status: 400 })
    }
  })

  it('refuses the same signed key points posted with a different text', () => {
    const checked = post(handoff(), `${TEXT}\nA sentence that was added afterwards.`)

    expect(checked).toMatchObject({ ok: false, status: 400 })
    if (!checked.ok) expect(checked.error).toMatch(/text/i)
  })

  it('refuses a seal made with another key, a malformed seal, and a missing or malformed hand-off', () => {
    expect(post(makeHandoff(OTHER_KEY, TEXT, merged()))).toMatchObject({ ok: false, status: 400 })
    expect(post({ ...handoff(), seal: 'zz' })).toMatchObject({ ok: false, status: 400 })
    expect(post({ ...handoff(), seal: '' })).toMatchObject({ ok: false, status: 400 })
    expect(post(undefined)).toMatchObject({ ok: false, status: 400 })
    expect(post('a string')).toMatchObject({ ok: false, status: 400 })
    expect(post({ text: 7, seal: 'abc' })).toMatchObject({ ok: false, status: 400 })
    expect(validateSynthesizeBody({ text: TEXT, merged: merged() }, KEY)).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses a signed hand-off of another version, and a signed hand-off that is not a merge', () => {
    const body = JSON.parse(handoff().text) as Record<string, unknown>
    // Signed by this server's own key, so only the content checks can refuse them.
    const resign = (b: unknown) => ({ text: JSON.stringify(b), seal: sealOf(KEY, JSON.stringify(b)) })
    expect(post(resign({ ...body, v: 2 }))).toMatchObject({ ok: false })
    expect(post(resign({ ...body, merged: 'nope' }))).toMatchObject({ ok: false })
  })

  it('signs which chunks request 1 asked twice, and refuses a changed or invented list', () => {
    const signed = makeHandoff(KEY, TEXT, merged(), Date.now(), [2])
    const checked = post(signed)
    expect(checked.ok && checked.resume.retried).toEqual([2])
    expect(post(handoff())).toMatchObject({ ok: true })

    const body = JSON.parse(signed.text) as { retried: unknown }
    body.retried = []
    expect(post({ text: JSON.stringify(body), seal: signed.seal })).toMatchObject({ ok: false, status: 400 })
    // Signed by this server's own key, so only the content check can refuse these.
    expect(post(makeHandoff(KEY, TEXT, merged(), Date.now(), [9]))).toMatchObject({ ok: false, status: 400 })
    expect(post(makeHandoff(KEY, TEXT, merged(), Date.now(), ['2'] as unknown as number[]))).toMatchObject({ ok: false, status: 400 })
  })

  it('still checks every id and chunk of a correctly signed hand-off', () => {
    const forged = structuredClone(merged())
    forged.byChunk[0]!.points[1]!.id = '9.9'

    expect(post(makeHandoff(KEY, TEXT, forged))).toMatchObject({ ok: false, status: 400 })
  })
})
