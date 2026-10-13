import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8')

describe('status dots', () => {
  it('no rule recolours a dot inside a badge, so each .ds-dot--* class shows its own state colour', () => {
    expect(css).not.toMatch(/\.ds-badge\s+\.ds-dot[^{]*\{[^}]*background/)
  })

  it('every state the header and the figure check show has its own dot or badge colour', () => {
    for (const state of ['ok', 'failed', 'running', 'stopped']) expect(css).toMatch(new RegExp(`\\.ds-dot--${state}[^{]*\\{[^}]*background`))
    for (const badge of ['success', 'warning', 'danger', 'accent']) expect(css).toMatch(new RegExp(`\\.ds-badge--${badge}\\s*\\{[^}]*color`))
  })
})
