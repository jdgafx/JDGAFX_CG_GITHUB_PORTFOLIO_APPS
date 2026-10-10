import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The desktop fold rule: at 1280 px wide and 900 px tall the filmstrip sits in the first view. */
const FOLD = '@media (min-width: 1280px) and (min-height: 900px)'

/** The text of one top-level block: from its opening line to the first closing brace at column 0. */
function block(css: string, opener: string): string {
  const start = css.indexOf(opener)
  expect(start, `${opener} is in the stylesheet`).toBeGreaterThanOrEqual(0)
  const end = css.indexOf('\n}\n', start)
  expect(end, `${opener} closes`).toBeGreaterThan(start)
  return css.slice(start, end + 3)
}

const app = readFileSync('src/styles/app.css', 'utf8')
const replay = readFileSync('src/styles/replay.css', 'utf8')
const main = readFileSync('src/main.tsx', 'utf8')

describe('desktop fold rule', () => {
  it('caps the replay picture to 232 px, both the box and the image, cropped from the top left', () => {
    const fold = block(replay, FOLD)
    expect(fold).toMatch(/\.bb-window \.bb-shot \{\s*max-height: 232px;/)
    expect(fold).toMatch(/\.bb-shot__open img \{\s*max-height: 232px;\s*object-fit: cover;\s*object-position: top left;/)
  })

  it('tightens the replay gap to 12 px at the same size only', () => {
    expect(block(replay, FOLD)).toMatch(/\.bb-replay \{\s*gap: 12px;/)
  })

  it('gives back the page chrome above the result at the same size only', () => {
    const fold = block(app, FOLD)
    expect(fold).toMatch(/\.ds-main \{\s*padding-top: 16px;\s*gap: 16px;/)
    expect(fold).toMatch(/\.ds-run__result > \.ds-lead \{\s*padding-top: 16px;\s*gap: 12px;/)
  })

  it('lets the read box shrink to 56 px at the same size, so a two-to-six step detail fits the first view', () => {
    expect(block(replay, FOLD)).toMatch(/\.bb-viewer \.bb-pre \{\s*min-height: 56px;/)
  })

  it('keeps a detail that is too long scrolling inside its own column at the same size', () => {
    expect(block(replay, FOLD)).toMatch(/\.bb-viewer \.bb-viewer__detail \{\s*overflow-y: auto;/)
  })

  it('moved the threshold to 900 px tall in both stylesheets, so no 860 px rule is left', () => {
    expect(app).not.toContain('(min-height: 860px)')
    expect(replay).not.toContain('(min-height: 860px)')
    expect(app).toContain(FOLD)
    expect(replay).toContain(FOLD)
  })

  it('loads replay.css after app.css, so its override wins the cascade', () => {
    const appAt = main.indexOf("'./styles/app.css'")
    const replayAt = main.indexOf("'./styles/replay.css'")
    expect(appAt).toBeGreaterThan(-1)
    expect(replayAt).toBeGreaterThan(appAt)
  })
})
