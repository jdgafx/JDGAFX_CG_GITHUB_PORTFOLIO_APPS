import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExplainReply } from '../../shared/types'
import App from '../../src/App'
import { byText, cleanup, click, explainFromCapture, flush, mount, NPM_ROWS, RELEASES, RUN_DATE } from './helpers'
import r2Vite from './fixtures/response-r2-vite.json'
import r2Webpack from './fixtures/response-r2-webpack.json'
import r2Esbuild from './fixtures/response-r2-esbuild.json'

/**
 * WP1's real functions (shared/*) against the real npm captures of 2026-10-12 and the real model captures of
 * Step 0r6. Only the network is faked. This is the check that the UI and the core agree.
 */
const CAPTURES: Record<string, unknown> = { vite: r2Vite, webpack: r2Webpack, esbuild: r2Esbuild }

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function runPreset() {
  const deps = {
    today: () => RUN_DATE,
    fetchRange: async (name: string) => ({ name, status: 'ok' as const, rows: NPM_ROWS[name]! }),
    fetchReleases: async (name: string) => ({ name, status: 'ok' as const, releases: RELEASES[name]! }),
    postExplain: async (req: { target: string }): Promise<ExplainReply> => ({
      ...explainFromCapture(CAPTURES[req.target]),
      newestModel: 'anthropic/claude-haiku-5.5',
      costUsd: 0.0016,
    }),
  }
  const { container } = mount(<App deps={deps} />)
  await flush()
  await click(byText(container, '.ds-choice', 'Vite vs webpack vs esbuild'))
  await flush(6)
  await click(byText(container, 'button', 'Explain spikes'))
  await flush(12)
  return container
}

describe('UI with the real core', () => {
  it('shows metrics, charts and the unusual-days table for a real preset before any run', async () => {
    const deps = {
      today: () => RUN_DATE,
      fetchRange: async (name: string) => ({ name, status: 'ok' as const, rows: NPM_ROWS[name]! }),
      fetchReleases: async (name: string) => ({ name, status: 'ok' as const, releases: RELEASES[name]! }),
    }
    const { container } = mount(<App deps={deps} />)
    await flush()
    await click(byText(container, '.ds-choice', 'Vite vs webpack vs esbuild'))
    await flush(6)
    expect(container.querySelectorAll('.metrics__package')).toHaveLength(3)
    expect(container.querySelectorAll('.charts svg')).toHaveLength(3)
    expect(container.querySelector('.unusual table')).not.toBeNull()
    expect(container.querySelector('.metrics__combined')).not.toBeNull()
    expect(container.querySelector('.live-chip')?.classList.contains('ds-chip--live')).toBe(true)
  })

  it('region digit test on real model output: no digit written by code outside the claim marks', async () => {
    const container = await runPreset()
    const region = container.querySelector('section.explanation')!
    expect(region.querySelectorAll('article')).toHaveLength(3)
    expect(container.querySelector('section.figure-check')).not.toBeNull()
    const clone = region.cloneNode(true) as Element
    clone.querySelectorAll('.claim, time.date-mark').forEach(el => el.remove())
    let text = clone.textContent ?? ''
    for (const n of ['vite', 'webpack', 'esbuild']) text = text.split(n).join('')
    // the model's own text segments may not hold digits either: the schema asks for none, the numeral pass marks any
    expect(text.replace(/\bpast month\b/g, '')).not.toMatch(/\d/)
  })

  it('the figure-check rows are the claim marks, in order, with numbered figures first', async () => {
    const container = await runPreset()
    const marks = container.querySelectorAll('section.explanation mark.claim:not(.claim--unchecked)')
    const rows = container.querySelectorAll('section.figure-check tbody tr')
    expect(marks.length).toBeGreaterThan(0)
    expect(rows.length).toBeGreaterThanOrEqual(marks.length)
    const numbers = Array.from(rows).map(r => r.querySelector('td')?.textContent).filter(Boolean)
    expect(numbers.slice(0, 3)).toEqual(['1', '2', '3'])
    // figure n in the region is the mark with id fig-n, and its text appears in row n
    for (const n of [1, 2, 3]) {
      const mark = container.querySelector(`#fig-${n}`)!
      expect(mark.textContent).toMatch(/\d/)
      expect(rows[Array.from(rows).findIndex(r => r.querySelector('td')?.textContent === String(n))]!.textContent).toContain(mark.textContent!)
    }
  })

  it('a wrong figure keeps the npm value out of the region and in the mark title', async () => {
    const container = await runPreset()
    const wrong = container.querySelectorAll('section.explanation mark.claim--wrong')
    expect(wrong.length).toBeGreaterThan(0)
    for (const mark of Array.from(wrong)) {
      // a figure that is wrong against npm carries npm's value in its title; a value in the wrong form carries the reason
      expect(mark.getAttribute('title')).toMatch(mark.textContent === '(no value)' ? /^Wrong: / : /^npm: /)
      expect(mark.parentElement?.textContent).toContain('(differs from npm)')
    }
    expect(container.querySelector('section.explanation')?.textContent).not.toMatch(/npm: /)
  })

  it('names the window in words: a compare at days 30 reads "for the past month"', async () => {
    const container = await runPreset()
    const compares = Array.from(container.querySelectorAll('section.explanation mark.claim')).filter(m => m.textContent?.includes('total for'))
    expect(compares.length).toBeGreaterThan(0)
    for (const c of compares) expect(c.textContent).toMatch(/total for the past month/)
  })

  it('N6: a change_pct claim renders with its % sign and one decimal, and no extra word follows it', async () => {
    const base = {
      today: () => RUN_DATE,
      fetchRange: async (name: string) => ({ name, status: 'ok' as const, rows: NPM_ROWS[name]! }),
      fetchReleases: async (name: string) => ({ name, status: 'ok' as const, releases: RELEASES[name]! }),
    }
    // read the change the page itself shows for vite, then have the model state it to two decimals
    const probe = mount(<App deps={base} />)
    await flush()
    await click(byText(probe.container, '.ds-choice', 'Vite vs webpack vs esbuild'))
    await flush(6)
    const card = Array.from(probe.container.querySelectorAll('.metrics__package')).find(c => c.textContent?.startsWith('vite'))!
    const shown = Array.from(card.querySelectorAll('dt')).find(dt => dt.textContent === 'Change')!.nextElementSibling!.textContent!
    expect(shown).toMatch(/^[+-]\d+\.\d%$/)
    cleanup()

    const postExplain = async (): Promise<ExplainReply> => ({
      ok: true,
      servedModel: 'anthropic/claude-haiku-5.5',
      usage: { prompt: 1, completion: 1, reasoning: 1 },
      modelMs: 1,
      newestModel: 'anthropic/claude-haiku-5.5',
      costUsd: 0.001,
      paragraph: [
        { t: 'text', s: 'The average per day moved ' },
        { t: 'claim', kind: 'change_pct', package: 'vite', span: 'none', day: '', value: `${shown.slice(0, -1)}0` },
        { t: 'text', s: ' against the month before.' },
      ],
    })
    const { container } = mount(<App deps={{ ...base, postExplain }} />)
    await flush()
    await click(byText(container, '.ds-choice', 'Vite vs webpack vs esbuild'))
    await flush(6)
    await click(byText(container, 'button', 'Explain spikes'))
    await flush(12)
    const mark = container.querySelector('section.explanation article mark.claim')!
    expect(mark.textContent).toBe(shown)
    expect(mark.classList.contains('claim--checked')).toBe(true)
    expect(mark.parentElement?.textContent).toContain(`${shown} vite · change in average per day with downloads`)
    expect(mark.parentElement?.textContent).not.toContain('percent')
  })
})
