import { afterEach, describe, expect, it, vi } from 'vitest'
import Controls from '../../src/components/Controls'
import HowTo from '../../src/components/HowTo'
import { byText, cleanup, click, mount, typeInto } from '../ui/helpers'

afterEach(cleanup)

describe('HowTo', () => {
  it('has the line, the three steps and a primary Try it', () => {
    const { container } = mount(<HowTo hasResult={false} disabled={false} onTry={() => {}} />)
    const section = container.querySelector('section.howto')!
    expect(section.querySelector('h2')?.textContent).toBe('How to use')
    expect(section.textContent).toContain('See how npm package downloads changed and why some days stand out.')
    const steps = Array.from(section.querySelectorAll('ol li')).map(li => li.textContent)
    expect(steps).toEqual([
      'Type a package name and press Add, or open Ready-made comparisons.',
      'Pick 30 days, 90 days or 365 days.',
      'Press Explain spikes; the explanation takes about 20 seconds.',
    ])
    const tryIt = byText(section, 'button', 'Try it')!
    expect(tryIt.classList.contains('ds-button--primary')).toBe(true)
  })

  it('calls onTry, and is disabled when told to be', async () => {
    const onTry = vi.fn()
    const a = mount(<HowTo hasResult={false} disabled={false} onTry={onTry} />)
    await click(byText(a.container, 'button', 'Try it'))
    expect(onTry).toHaveBeenCalledTimes(1)
    const b = mount(<HowTo hasResult={false} disabled onTry={onTry} />)
    expect((byText(b.container, 'button', 'Try it') as HTMLButtonElement).disabled).toBe(true)
  })

  it('collapses while a result is shown and the toggle brings it back', async () => {
    const { container } = mount(<HowTo hasResult disabled={false} onTry={() => {}} />)
    expect(byText(container, 'button', 'Try it')).toBeNull()
    await click(byText(container, 'button', 'Show'))
    expect(byText(container, 'button', 'Try it')).not.toBeNull()
  })
})

describe('Controls', () => {
  const base = {
    names: ['react'],
    days: 30 as const,
    busy: false,
    canRun: true,
    onAdd: () => null as string | null,
    onRemove: () => {},
    onPreset: () => {},
    onDays: () => {},
    onExplain: () => {},
  }

  it('the two spec preset labels are exact and a click sets names only', async () => {
    const onPreset = vi.fn()
    const onDays = vi.fn()
    const { container } = mount(<Controls {...base} onPreset={onPreset} onDays={onDays} />)
    const summary = container.querySelector('details.ds-disclosure > summary')
    expect(summary?.textContent).toBe('Ready-made comparisons')
    const labels = Array.from(container.querySelectorAll('.ds-choice__label')).map(l => l.textContent)
    expect(labels).toHaveLength(2)
    expect(labels).toContain('Vite vs webpack vs esbuild')
    expect(labels).toContain('Prisma vs Drizzle vs TypeORM')
    await click(byText(container, '.ds-choice', 'Vite vs webpack vs esbuild'))
    expect(onPreset).toHaveBeenCalledWith(['vite', 'webpack', 'esbuild'])
    await click(byText(container, '.ds-choice', 'Prisma vs Drizzle vs TypeORM'))
    expect(onPreset).toHaveBeenLastCalledWith(['prisma', 'drizzle-orm', 'typeorm'])
    expect(onDays).not.toHaveBeenCalled()
  })

  it('the window control offers 30, 90 and 365 days and marks the current one', async () => {
    const onDays = vi.fn()
    const { container } = mount(<Controls {...base} days={90} onDays={onDays} />)
    const buttons = Array.from(container.querySelectorAll('.ds-seg > button'))
    expect(buttons.map(b => b.textContent)).toEqual(['30 days', '90 days', '365 days'])
    expect(buttons.map(b => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
    await click(buttons[2]!)
    expect(onDays).toHaveBeenCalledWith(365)
  })

  it('Add passes the typed name on and clears the field; a refusal shows its reason', async () => {
    const onAdd = vi.fn<(raw: string) => string | null>().mockReturnValueOnce(null).mockReturnValueOnce('Up to 4 packages.')
    const { container } = mount(<Controls {...base} onAdd={onAdd} />)
    const input = container.querySelector<HTMLInputElement>('input')!
    await typeInto(input, 'vue')
    await click(byText(container, 'button', 'Add'))
    expect(onAdd).toHaveBeenCalledWith('vue')
    expect(input.value).toBe('')
    await typeInto(input, 'svelte')
    await click(byText(container, 'button', 'Add'))
    expect(container.querySelector('.ds-help--error')?.textContent).toBe('Up to 4 packages.')
    expect(input.value).toBe('svelte')
  })

  it('shows a removable chip per name', async () => {
    const onRemove = vi.fn()
    const { container } = mount(<Controls {...base} names={['react', 'vue']} onRemove={onRemove} />)
    expect(container.querySelectorAll('.ds-chips .ds-chip')).toHaveLength(2)
    await click(container.querySelector('button[aria-label="Remove vue"]'))
    expect(onRemove).toHaveBeenCalledWith('vue')
  })

  it('Explain spikes is disabled while gated or busy, and runs when enabled', async () => {
    const onExplain = vi.fn()
    const on = mount(<Controls {...base} onExplain={onExplain} />)
    await click(byText(on.container, 'button', 'Explain spikes'))
    expect(onExplain).toHaveBeenCalledTimes(1)
    const gated = mount(<Controls {...base} canRun={false} />)
    expect((byText(gated.container, 'button', 'Explain spikes') as HTMLButtonElement).disabled).toBe(true)
    const busy = mount(<Controls {...base} busy />)
    expect((byText(busy.container, 'button', 'Explain spikes') as HTMLButtonElement).disabled).toBe(true)
  })
})
