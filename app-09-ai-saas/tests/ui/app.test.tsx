import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExplainReply } from '../../shared/types'
import App from '../../src/App'
import type { RunDeps } from '../../src/lib/useRun'
import { byText, cleanup, click, explainFromCapture, flush, mount } from './helpers'
import { makeStubCore } from './stubCore'
import r1aReact from './fixtures/response-r1a-react.json'
import r1aVite from './fixtures/response-r1a-vite.json'
import r1aZod from './fixtures/response-r1a-zod.json'
import r1aSdk from './fixtures/response-r1a-anthropic-ai2Fsdk.json'

const reply = (capture: unknown): ExplainReply => ({ ...explainFromCapture(capture), newestModel: 'anthropic/claude-haiku-5.5', costUsd: 0.0016 })
const unavailable: ExplainReply = { ok: false, reason: 'model-unavailable', servedModel: null, newestModel: null, costUsd: null }
const CAPTURES: Record<string, unknown> = { react: r1aReact, vite: r1aVite, zod: r1aZod, '@anthropic-ai/sdk': r1aSdk }

function deps(over: Partial<RunDeps> = {}): Partial<RunDeps> {
  return {
    core: makeStubCore(),
    fetchRange: async name => ({ name, status: 'ok', rows: {} }),
    fetchReleases: async name => ({ name, status: 'ok', releases: [] }),
    postExplain: async req => reply(CAPTURES[req.target] ?? r1aReact),
    ...over,
  }
}

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const pick = async (container: HTMLElement) => {
  await click(byText(container, '.ds-choice', 'Vite vs webpack vs esbuild'))
  await flush(6)
}
const chipText = (c: HTMLElement) => c.querySelector('.live-chip')?.textContent

describe('App', () => {
  it('shows the masthead chip, the how-to with Try it, and the three controls', async () => {
    const { container } = mount(<App deps={deps()} />)
    await flush()
    // a cold visit draws the Try it comparison from npm at once: the chip is lit, no explanation is asked for
    expect(chipText(container)).toBe('Live data: npm registry')
    expect(container.querySelector('.live-chip')?.classList.contains('ds-chip--live')).toBe(true)
    expect(Array.from(container.querySelectorAll('.ds-chips .ds-chip')).map(c => c.textContent?.replace('×', ''))).toEqual(['react', 'vite', 'zod', '@anthropic-ai/sdk'])
    expect(container.querySelector('.ds-run__result')).toBeNull()
    expect((byText(container, 'button', 'Try it') as HTMLButtonElement).disabled).toBe(false)
    await pick(container)
    expect(container.querySelector('.live-chip')?.classList.contains('ds-chip--live')).toBe(true)
    expect(container.querySelector('section.howto h2')?.textContent).toBe('How to use')
    expect(byText(container, 'button', 'Explain spikes')).not.toBeNull()
    expect(container.querySelectorAll('.ds-seg > button')).toHaveLength(3)
    // the chip and how-to come before the controls in the page
    const order = [container.querySelector('.live-chip'), container.querySelector('.howto'), container.querySelector('.ds-controls')]
    expect(order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('defaults to 365 days and a preset click sets names only', async () => {
    const { container } = mount(<App deps={deps()} />)
    await flush()
    expect(container.querySelector('.ds-seg > button[aria-pressed="true"]')?.textContent).toBe('365 days')
    await click(byText(container, '.ds-choice', 'Vite vs webpack vs esbuild'))
    await flush()
    expect(Array.from(container.querySelectorAll('.ds-chips .ds-chip')).map(c => c.textContent?.replace('×', ''))).toEqual(['vite', 'webpack', 'esbuild'])
    expect(container.querySelector('.ds-seg > button[aria-pressed="true"]')?.textContent).toBe('365 days')
  })

  it('Try it selects the four names and 365, runs, shows every paragraph and focuses the explanation heading', async () => {
    const posts: string[] = []
    const { container } = mount(<App deps={deps({ postExplain: async req => (posts.push(req.target), reply(CAPTURES[req.target]!)) })} />)
    await flush()
    await click(byText(container, 'button', 'Try it'))
    await flush(10)
    expect(Array.from(container.querySelectorAll('.ds-chips .ds-chip')).map(c => c.textContent?.replace('×', ''))).toEqual(['react', 'vite', 'zod', '@anthropic-ai/sdk'])
    expect(container.querySelector('.ds-seg > button[aria-pressed="true"]')?.textContent).toBe('365 days')
    expect(posts).toEqual(['react', 'vite', 'zod', '@anthropic-ai/sdk'])
    expect(container.querySelectorAll('section.explanation article')).toHaveLength(4)
    expect(document.activeElement?.id).toBe('explanation-title')
    expect(container.querySelector('section.figure-check')).not.toBeNull()
    expect(container.querySelector('.ds-chip.model-chip')?.textContent).toBe('claude-haiku-5.5')
    // the result leads, the readout follows
    const result = container.querySelector('.ds-run__result')!
    expect(result.compareDocumentPosition(container.querySelector('.ds-run__readout')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Explain spikes and Try it are off until both fetches settle', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    const { container } = mount(<App deps={deps({ fetchReleases: async name => (await gate, { name, status: 'ok' as const, releases: [] }) })} />)
    await flush()
    await click(byText(container, '.ds-choice', 'Vite vs webpack vs esbuild'))
    await flush()
    expect((byText(container, 'button', 'Explain spikes') as HTMLButtonElement).disabled).toBe(true)
    expect((byText(container, 'button', 'Try it') as HTMLButtonElement).disabled).toBe(true)
    release()
    await flush()
    expect((byText(container, 'button', 'Explain spikes') as HTMLButtonElement).disabled).toBe(false)
    expect((byText(container, 'button', 'Try it') as HTMLButtonElement).disabled).toBe(false)
  })

  it('every download failing: chip "· unavailable", an error notice, no figures, Explain spikes off', async () => {
    const { container } = mount(<App deps={deps({ fetchRange: async name => ({ name, status: 'failed', reason: 'network' }) })} />)
    await flush()
    await pick(container)
    expect(chipText(container)).toBe('Live data: npm registry · unavailable')
    expect(container.querySelector('.notices .ds-notice--error')).not.toBeNull()
    expect(container.querySelector('.metrics')).toBeNull()
    expect((byText(container, 'button', 'Explain spikes') as HTMLButtonElement).disabled).toBe(true)
  })

  it('rev 8.3: Try it with npm blocked ends as a failed run: no green Explained, one notice each, no "other packages", no model call, cost $0', async () => {
    const post = vi.fn(async () => unavailable)
    const { container } = mount(<App deps={deps({ fetchRange: async name => ({ name, status: 'failed', reason: 'network' }), postExplain: post })} />)
    await flush()
    await click(byText(container, 'button', 'Try it'))
    await flush(10)
    expect(post).not.toHaveBeenCalled()
    expect(container.querySelector('.ds-app')?.getAttribute('data-run')).toBe('failed')
    expect(container.querySelector('.ds-header .ds-badge')?.textContent).toBe('Run failed')
    expect(container.querySelector('.ds-badge--success')).toBeNull()
    expect(container.querySelectorAll('.ds-notice--error')).toHaveLength(1)
    expect(container.querySelectorAll('.ds-notice--warning')).toHaveLength(1)
    expect(container.textContent).not.toContain('The other packages are shown')
    const cost = Array.from(container.querySelectorAll('.ds-strip__item')).find(i => i.textContent?.startsWith('Cost'))!
    expect(cost.textContent).toBe('Cost$0')
  })

  it('rev 8.3: with some packages missing, the run is done and the notice keeps "The other packages are shown."', async () => {
    const { container } = mount(<App deps={deps({ fetchRange: async name => (name === 'zod' ? { name, status: 'failed', reason: 'network' } : { name, status: 'ok', rows: {} }), postExplain: async req => reply(CAPTURES[req.target]!) })} />)
    await flush()
    await click(byText(container, 'button', 'Try it'))
    await flush(10)
    expect(container.querySelector('.ds-app')?.getAttribute('data-run')).not.toBe('failed')
    expect(container.textContent).toContain('npm did not return downloads for zod. The other packages are shown.')
    expect(container.querySelectorAll('.ds-notice--warning')).toHaveLength(1)
  })

  it('releases failing with downloads ok: chip "· releases unavailable", a warning, the run still goes', async () => {
    const { container } = mount(<App deps={deps({ fetchReleases: async name => ({ name, status: 'failed', releases: [] }) })} />)
    await flush()
    await pick(container)
    expect(chipText(container)).toBe('Live data: npm registry · releases unavailable')
    expect(container.querySelector('.ds-notice--warning')?.textContent).toContain('release history')
    expect((byText(container, 'button', 'Explain spikes') as HTMLButtonElement).disabled).toBe(false)
  })

  it('every model call failing: the region shows the error once, the readout chip says unavailable and the masthead chip stays lit', async () => {
    const { container } = mount(<App deps={deps({ postExplain: async () => unavailable })} />)
    await flush()
    await pick(container)
    await click(byText(container, 'button', 'Explain spikes'))
    await flush(8)
    expect(container.querySelectorAll('section.explanation .ds-state--error')).toHaveLength(1)
    expect(container.querySelector('.ds-strip .model-chip')?.textContent).toBe('model · unavailable')
    expect(container.querySelector('.ds-strip .model-chip')?.classList.contains('ds-chip--remove')).toBe(true)
    expect(chipText(container)).toBe('Live data: npm registry')
    expect(container.querySelector('.ds-app')?.getAttribute('data-run')).toBe('failed')
  })

  it('one model call failing: the others render and the chip says partial', async () => {
    const { container } = mount(<App deps={deps({ postExplain: async req => (req.target === 'vite' ? unavailable : reply(CAPTURES[req.target]!)) })} />)
    await flush()
    await click(byText(container, 'button', 'Try it'))
    await flush(10)
    expect(container.querySelectorAll('section.explanation .ds-state--error')).toHaveLength(1)
    expect(container.querySelector('.ds-strip .model-chip')?.textContent).toBe('claude-haiku-5.5 · partial')
    expect(container.querySelector('section.figure-check')?.textContent).toContain('3 of 4 package explanations shown')
  })
})
