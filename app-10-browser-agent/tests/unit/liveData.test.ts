import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clock, liveDataOf, plannedHosts } from '../../src/lib/liveData'
import { initialRunState, runReducer, type RunState } from '../../src/lib/runState'
import type { BotStep, RunEvent } from '../../src/types'

const STEPS: BotStep[] = [
  { action: 'navigate', target: 'Hacker News', thought: 'Open it.', url: 'https://news.ycombinator.com/' },
  { action: 'extract', target: 'titles', thought: 'Read them.', selector: '.titleline > a' },
]
const NOON = Date.UTC(2026, 9, 9, 12, 0, 0)

function after(state: RunState, ...events: RunEvent[]): RunState {
  return events.reduce((acc, event) => runReducer(acc, { type: 'event', event, at: NOON }), state)
}

const planned: RunState = { ...initialRunState, steps: STEPS, phase: 'running' }
const FIRST_PAGE: RunEvent = {
  type: 'step_complete', index: 0, name: 'Navigate: Hacker News', status: 'ok', ms: 1229, detail: 'Opened news.ycombinator.com.',
  observed: { url: 'https://news.ycombinator.com/', title: 'Hacker News', excerpt: 'Hacker News new | past' },
}

describe('live-data indicator', () => {
  it('is idle before any page was read, naming the source and the fetcher', () => {
    expect(liveDataOf(initialRunState)).toMatchObject({ state: 'idle', text: 'Live data: allowed sites via headless Chromium' })
    expect(liveDataOf(planned)).toMatchObject({ state: 'idle', text: 'Live data: news.ycombinator.com via headless Chromium' })
  })

  it('lights up only when the browser really read a page, with the page host and the time', () => {
    const live = liveDataOf(after(planned, FIRST_PAGE))
    expect(live.state).toBe('live')
    expect(live.text).toBe(`Live data: news.ycombinator.com via headless Chromium · fetched ${clock(NOON)}`)
    expect(live.title).toContain('news.ycombinator.com')
  })

  it('stays idle for a step that finished without a page, and for a failed or skipped step', () => {
    const failedStep: RunEvent = { ...FIRST_PAGE, status: 'failed', observed: undefined }
    expect(liveDataOf(after(planned, { ...FIRST_PAGE, observed: undefined })).state).toBe('idle')
    expect(liveDataOf(after(planned, failedStep)).state).toBe('idle')
    expect(liveDataOf(after(planned, { ...FIRST_PAGE, status: 'skipped' })).state).toBe('idle')
  })

  it('reports unavailable when the run failed before any page was read', () => {
    const failed = after(planned, { type: 'error', message: 'The browser could not start. Try again in a moment.', index: null })
    expect(liveDataOf(failed)).toMatchObject({ state: 'failed', text: 'Live data unavailable: news.ycombinator.com via headless Chromium' })
  })

  it('stays live when a later step fails, because the first page was real', () => {
    const state = after(planned, FIRST_PAGE, { type: 'error', message: 'The target was not found.', index: 1 })
    expect(liveDataOf(state).state).toBe('live')
  })

  it('keeps the first fetch time when more pages arrive', () => {
    const later = runReducer(after(planned, FIRST_PAGE), { type: 'event', event: { ...FIRST_PAGE, index: 1 }, at: NOON + 60_000 })
    expect(later.liveAt).toBe(NOON)
  })

  it('lists each planned host once', () => {
    const twice: RunState = { ...planned, steps: [...STEPS, { ...STEPS[0], url: 'https://en.wikipedia.org/wiki/France' }, STEPS[0]] }
    expect(plannedHosts(twice)).toEqual(['news.ycombinator.com', 'en.wikipedia.org'])
  })
})

describe('no canned results', () => {
  /** Every source file a visitor's request can reach. */
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
    })
  }

  it('has no mock, sample, demo, canned or fixture data in src or netlify', () => {
    const banned = /\b(mock|mocks|sample data|sampleData|demo data|demoData|canned|fixture|fixtures|fakeData|hard-?coded result)\b/i
    const hits = [...sources('src'), ...sources('netlify')].filter((file) => banned.test(readFileSync(file, 'utf8')))
    expect(hits).toEqual([])
  })
})
