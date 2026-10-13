import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/styles/lightbox.css', 'utf8')
const tokens = readFileSync('src/styles/tokens.css', 'utf8')

// The look is CSS, so these read the stylesheet; the rendered result is checked in a real browser (design-judge/app-08/judge.md).
describe('the film edge in the dark scheme', () => {
  it('is lighter than the page, so the holes and the edge show', () => {
    const dark = css.match(/prefers-color-scheme: dark\) \{ :root:not\(\[data-theme="light"\]\) \{ --vl-film: (#[0-9a-f]{6})/)?.[1]
    const page = tokens.match(/prefers-color-scheme: dark\)[\s\S]*?--ds-bg: (#[0-9a-f]{6})/)?.[1]
    expect(dark).toBeDefined()
    expect(page).toBeDefined()
    expect(dark).not.toBe(page)
    // the holes are painted in the page colour on the film colour
    expect(css).toMatch(/var\(--ds-bg\) 8px 18px[\s\S]*?var\(--vl-film\)/)
    expect(css).toContain(':root[data-theme="dark"] { --vl-film: ' + dark)
  })
})

describe('the mode segments during a run', () => {
  it('keep the chosen one fully opaque while the others stay dimmed', () => {
    expect(css).toContain('.vl-scope > button[aria-pressed="true"]:disabled { opacity: 1;')
  })
})

describe('the picture beside its answer', () => {
  it('sits in two columns once the hero is 760 px wide, with a capped picture, so the answer and the readout stay on the first screen', () => {
    expect(css).toMatch(/@container \(min-width: 760px\) \{[^}]*grid-template-columns: minmax\(0, 0\.78fr\) minmax\(0, 1\.22fr\)/)
    expect(css).toMatch(/@container \(min-width: 760px\)[\s\S]*?max-height: min\(48vh, 380px\)/)
  })
  it('is capped to 240 px on a phone and the tagline folds away, so the answer is nearer the top', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 720px)'))
    expect(phone).toContain('.ds-subtitle { display: none; }')
    expect(phone).toContain('max-height: min(30vh, 240px)')
  })
})
