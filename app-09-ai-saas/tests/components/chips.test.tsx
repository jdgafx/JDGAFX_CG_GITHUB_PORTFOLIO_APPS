import { afterEach, describe, expect, it } from 'vitest'
import LiveChip, { liveState } from '../../src/components/LiveChip'
import ModelChip from '../../src/components/ModelChip'
import { cleanup, mount } from '../ui/helpers'

afterEach(cleanup)

describe('LiveChip', () => {
  const chip = (state: Parameters<typeof LiveChip>[0]['state']) => mount(<LiveChip state={state} />).container.querySelector('.ds-chip')!

  it('idle: muted, no suffix', () => {
    const el = chip('idle')
    expect(el.textContent?.trim()).toBe('Live data: npm registry')
    expect(el.classList.contains('ds-chip--muted')).toBe(true)
  })
  it('lit: live class, no suffix', () => {
    const el = chip('live')
    expect(el.textContent?.trim()).toBe('Live data: npm registry')
    expect(el.classList.contains('ds-chip--live')).toBe(true)
  })
  it('downloads blocked: remove class and "· unavailable"', () => {
    const el = chip('downloads-blocked')
    expect(el.textContent?.trim()).toBe('Live data: npm registry · unavailable')
    expect(el.classList.contains('ds-chip--remove')).toBe(true)
  })
  it('registry blocked with downloads ok: change class and "· releases unavailable"', () => {
    const el = chip('releases-blocked')
    expect(el.textContent?.trim()).toBe('Live data: npm registry · releases unavailable')
    expect(el.classList.contains('ds-chip--change')).toBe(true)
  })
  it('is a polite status region', () => {
    const el = chip('live')
    expect(el.getAttribute('role')).toBe('status')
  })

  it('derives the state from the two fetches', () => {
    expect(liveState(['loading'], ['loading'])).toBe('idle')
    expect(liveState(['ok'], ['loading'])).toBe('idle')
    expect(liveState(['ok', 'ok'], ['ok', 'ok'])).toBe('live')
    expect(liveState(['failed', 'failed'], ['ok', 'ok'])).toBe('downloads-blocked')
    expect(liveState(['failed', 'failed'], ['loading', 'loading'])).toBe('downloads-blocked')
    expect(liveState(['ok', 'failed'], ['ok', 'ok'])).toBe('live')
    expect(liveState(['ok', 'ok'], ['ok', 'failed'])).toBe('releases-blocked')
    expect(liveState([], [])).toBe('idle')
  })
})

describe('ModelChip (N5)', () => {
  const text = (el: Element) => el.textContent?.replace(/\s+/g, ' ').trim()
  const model = 'anthropic/claude-haiku-5.5'

  it('all calls failed: "model · unavailable" with ds-chip--remove', () => {
    const el = mount(<ModelChip outcome="all-failed" model={null} marker="not-reported" />).container.querySelector('.ds-chip')!
    expect(text(el)).toBe('model · unavailable')
    expect(el.classList.contains('ds-chip--remove')).toBe(true)
  })

  it('some failed: the worst marker plus "· partial", full id in title', () => {
    const el = mount(<ModelChip outcome="partial" model={model} marker="mismatch" />).container.querySelector('.ds-chip')!
    expect(text(el)).toBe('claude-haiku-5.5 · not newest · partial')
    expect(el.getAttribute('title')).toContain(model)
  })

  it('shows each of the four markers', () => {
    const t = (marker: Parameters<typeof ModelChip>[0]['marker'], m: string | null) =>
      text(mount(<ModelChip outcome="ok" model={m} marker={marker} />).container.querySelector('.ds-chip')!)
    expect(t('match', model)).toBe('claude-haiku-5.5')
    expect(t('mismatch', model)).toBe('claude-haiku-5.5 · not newest')
    expect(t('unchecked', model)).toBe('claude-haiku-5.5 · unchecked')
    expect(t('not-reported', null)).toBe('model · not reported')
  })

  it('uses the shared wrapping chip class instead of clipping', () => {
    const el = mount(<ModelChip outcome="ok" model={model} marker="match" />).container.querySelector('.ds-chip')!
    expect(el.classList.contains('ds-chip--wrap')).toBe(true)
  })
})
