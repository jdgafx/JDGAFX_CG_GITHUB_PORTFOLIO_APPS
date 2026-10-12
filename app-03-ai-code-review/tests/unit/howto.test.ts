import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HowTo } from '../../src/components/HowTo'
import { reviewCode } from '../../src/lib/api'
import { EXAMPLE_LINK, loadExample } from '../../src/lib/tryit'

const html = (busy = false, error: string | null = null) => renderToStaticMarkup(createElement(HowTo, { busy, error, collapseKey: 0, onTry: () => {} }))

describe('How to use block', () => {
  it('has an h2, an ordered list of one to four steps and a Try it button', () => {
    const out = html()
    expect(out).toMatch(/<h2[^>]*>How to use<\/h2>/)
    const items = out.match(/<li>/g) ?? []
    expect(items.length).toBeGreaterThanOrEqual(1)
    expect(items.length).toBeLessThanOrEqual(4)
    expect(out).toContain('<ol')
    expect(out).toMatch(/<button[^>]*ds-button--primary[^>]*>Try it<\/button>/)
  })

  it('names the controls as they appear on screen', () => {
    const out = html()
    for (const label of ['Load file', 'Review code', 'Show in editor', 'Not confirmed']) expect(out).toContain(label)
  })

  it('disables Try it while busy and shows a load failure', () => {
    expect(html(true)).toMatch(/<button[^>]*disabled=""[^>]*>Try it<\/button>/)
    expect(html(false, 'Could not reach GitHub.')).toContain('role="alert"')
  })
})

describe('Try it', () => {
  const fetchStub = vi.fn<(input: string, init: RequestInit) => Promise<Response>>()
  beforeEach(() => vi.stubGlobal('fetch', fetchStub))
  afterEach(() => {
    vi.unstubAllGlobals()
    fetchStub.mockReset()
  })

  it('fetches the example file from GitHub, then sends that exact text to the review endpoint', async () => {
    const text = 'export default function clsx() {\n  return 1\n}\n'
    fetchStub.mockImplementation(async (input) => {
      if (input.startsWith('https://api.github.com/')) {
        return new Response(JSON.stringify({ type: 'file', name: 'index.js', path: 'src/index.js', sha: 'abc1234', size: text.length, encoding: 'base64', content: btoa(text), html_url: EXAMPLE_LINK }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: true, result: { comments: [], summary: 's', mode: 'file', lineCount: 3, verified: true }, trace: [], usage: {}, model: 'm', totalMs: 1 }), { status: 200 })
    })
    const loaded = await loadExample()
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.value.language).toBe('javascript')
    expect(fetchStub.mock.calls[0]![0]).toContain('/repos/lukeed/clsx/contents/src/index.js')
    await reviewCode(loaded.value.file.text, loaded.value.language).catch(() => null)
    const [url, init] = fetchStub.mock.calls[1]!
    expect(url).toBe('/api/ai')
    expect(JSON.parse(String(init.body))).toMatchObject({ code: loaded.value.file.text, language: 'javascript' })
  })

  it('falls back to the same file from raw.githubusercontent.com when the contents API has spent its anonymous quota', async () => {
    const text = 'export default function clsx() {\n  return 1\n}\n'
    fetchStub.mockImplementation(async (input) =>
      input.startsWith('https://api.github.com/')
        ? new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })
        : new Response(text, { status: 200 }),
    )
    const loaded = await loadExample()
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(fetchStub.mock.calls[1]![0]).toBe('https://raw.githubusercontent.com/lukeed/clsx/v2.1.1/src/index.js')
    expect(loaded.value.file).toMatchObject({ text: text.replace(/\n$/, ''), path: 'src/index.js', ref: 'v2.1.1', url: 'https://github.com/lukeed/clsx/blob/v2.1.1/src/index.js' })
    expect(loaded.value.file.sha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('names the contents API failure when the raw file cannot be had either', async () => {
    fetchStub.mockImplementation(async (input) => (input.startsWith('https://api.github.com/') ? new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }) : new Response('', { status: 404 })))
    const loaded = await loadExample()
    expect(loaded).toMatchObject({ ok: false })
    if (!loaded.ok) expect(loaded.error).toContain('60 anonymous requests')
  })

  it('returns a message, not data, when GitHub fails', async () => {
    fetchStub.mockResolvedValue(new Response('{}', { status: 500 }))
    const loaded = await loadExample()
    expect(loaded.ok).toBe(false)
  })
})
