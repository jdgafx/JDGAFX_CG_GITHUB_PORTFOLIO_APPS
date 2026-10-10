import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HowTo from '../../src/components/HowTo'
import { ALLOWED_SITES, PRESETS, TRY_TASK } from '../../src/lib/constants'
import { runExample } from '../../src/lib/howto'
import { planTask } from '../../src/lib/api'
import type { Phase } from '../../src/lib/runState'
import { hostsIn } from '../../netlify/shared/domains'

function markup(phase: Phase, runId = 1): string {
  return renderToStaticMarkup(createElement(HowTo, { phase, runId, onTry: () => undefined }))
}

describe('How to use block', () => {
  it('has an h2, an ordered list of 1 to 4 steps naming the real controls, and a Try it button', () => {
    const html = markup('idle')
    expect(html).toContain('<section class="howto" aria-labelledby="howto-title">')
    expect(html).toMatch(/<h2 class="howto__title" id="howto-title">How to use<\/h2>/)
    const items = html.match(/<li>/g) ?? []
    expect(items.length).toBeGreaterThanOrEqual(1)
    expect(items.length).toBeLessThanOrEqual(4)
    // The labels match the interface text exactly.
    for (const label of ['Describe a web task', 'Example tasks', 'Plan and run']) expect(html).toContain(`<strong>${label}</strong>`)
    expect(html).toMatch(/<button type="button" class="ds-button ds-button--primary howto__try"[^>]*>Try it: Hacker News top stories<\/button>/)
  })

  it('says what the app does in one short line', () => {
    const line = /<p class="howto__line">([^<]+)<\/p>/.exec(markup('idle'))?.[1] ?? ''
    expect(line.split(' ').length).toBeLessThanOrEqual(18)
  })

  it('is open on the first visit and folded away while a result is shown', () => {
    expect(markup('idle')).toContain('<details open="">')
    for (const phase of ['complete', 'failed', 'stopped'] as const) expect(markup(phase)).toContain('<details>')
  })

  it('keeps Try it disabled while a run is live, and enabled otherwise', () => {
    for (const phase of ['planning', 'running'] as const) expect(markup(phase)).toMatch(/howto__try"[^>]*disabled=""/)
    for (const phase of ['idle', 'complete', 'failed', 'stopped'] as const) expect(markup(phase)).not.toMatch(/howto__try"[^>]*disabled/)
  })
})

describe('Try it', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('runs one of the real examples, on an allowed site, never a stored result', () => {
    expect(PRESETS).toContain(TRY_TASK)
    expect(hostsIn(TRY_TASK).every((host) => ALLOWED_SITES.some((site) => host === site || host.endsWith(`.${site}`)))).toBe(true)
  })

  it('fills the field with the example and starts the planning request with that task, through the usual run path', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'stop here' }), { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    const setTask = vi.fn()
    await runExample(setTask, (task) => planTask(task, new AbortController().signal).then(() => undefined, () => undefined))

    expect(setTask).toHaveBeenCalledWith(TRY_TASK)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe('/api/ai')
    expect(JSON.parse(init.body as string)).toEqual({ task: TRY_TASK })
  })
})
