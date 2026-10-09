import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyFrame, liveData, startRun, failRun } from '../../src/lib/runState'

describe('the live-data indicator', () => {
  it('is idle before any page is read, and stays idle through the plan and a search-only agent step', () => {
    let view = startRun()
    view = applyFrame(view, { type: 'node_end', node: 'plan', visit: 1, ms: 5, status: 'ok', detail: 'Planned searches: Expo 98' })
    view = applyFrame(view, { type: 'node_end', node: 'agent', visit: 1, ms: 5, status: 'ok', detail: 'Asked for wikipedia_search.' })
    expect(liveData(view)).toEqual({ state: 'idle', at: null })
  })

  it('lights only when the tools step read a page', () => {
    let view = startRun()
    view = applyFrame(view, { type: 'node_end', node: 'tools', visit: 1, ms: 300, status: 'ok', detail: "New sources: [1] Expo '98." })
    expect(liveData(view).state).toBe('live')
    expect(liveData(view).at).toBe(view.liveAt)
  })

  it('does not light for a tools step that found nothing, and reads failed once the run ended', () => {
    let view = startRun()
    view = applyFrame(view, { type: 'node_end', node: 'tools', visit: 1, ms: 300, status: 'ok', detail: 'No new source. Wikipedia did not answer in time.' })
    expect(liveData(view).state).toBe('idle')
    expect(liveData(failRun(view, 'x')).state).toBe('failed')
  })

  it('does not count a kept step of the original run as a fetch of this one, but shows the original time', () => {
    let view = startRun()
    view = applyFrame(view, { type: 'node_end', node: 'tools', visit: 1, ms: 300, status: 'ok', detail: "New sources: [1] Expo '98.", reused: true })
    expect(view.liveAt).toBeNull()
    expect(liveData(view, 123)).toEqual({ state: 'live', at: 123 })
  })
})

describe('a re-run whose own reads fail', () => {
  const tools = (view: ReturnType<typeof startRun>) =>
    applyFrame(view, { type: 'node_end', node: 'tools', visit: 1, ms: 300, status: 'ok', detail: 'No new source. Wikipedia did not answer in time.' })

  it('keeps the original time while it runs, then reads failed once it ended', () => {
    const running = tools(startRun())
    expect(liveData(running, 123)).toEqual({ state: 'live', at: 123 })
    expect(liveData(failRun(running, 'x'), 123)).toEqual({ state: 'failed', at: null })
  })

  it('a base run that read a page and then failed keeps its fetched time', () => {
    let view = applyFrame(startRun(), { type: 'node_end', node: 'tools', visit: 1, ms: 300, status: 'ok', detail: "New sources: [1] Expo '98." })
    view = failRun(view, 'model error')
    expect(liveData(view).state).toBe('live')
  })
})

describe('nothing canned is bundled', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? files(path) : [path]
    })
  const code = [...files('src'), ...files('netlify')]

  it('has no data files and no import from tests or fixtures in src or netlify', () => {
    expect(code.filter((path) => /\.(json|csv|ndjson)$/.test(path))).toEqual([])
    for (const path of code.filter((p) => /\.(ts|tsx)$/.test(p))) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/from ['"][^'"]*(tests|fixtures)\//)
    }
  })
})
