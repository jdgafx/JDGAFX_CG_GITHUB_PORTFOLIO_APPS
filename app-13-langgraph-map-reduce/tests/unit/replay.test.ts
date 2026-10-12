import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { recordedText, REPLAY_URL, replayDisabled } from '../../src/lib/useReplay'
import { isStale, parseRecording } from '../../src/replay'

const exchange = (path: string, body: string | null) => ({
  method: 'POST',
  path,
  request_body: body,
  status: 200,
  headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  t_start: 0,
  t_headers: 10,
  t_end: 20,
  chunks: [{ t: 15, text: 'data: [DONE]\n\n' }],
})

const recording = (over: Record<string, unknown> = {}) => ({
  version: 1,
  app: 'app-13-langgraph-map-reduce',
  url: 'https://example.netlify.app/',
  recorded_at: new Date().toISOString(),
  reported: { model: 'anthropic/claude-haiku-5.5', model_role: 'served by', cost_usd: 0.008, cost_scope: 'whole run' },
  exchanges: [exchange('/api/run', JSON.stringify({ text: 'The article.' })), exchange('/api/synthesize', '{"text":"The article.","handoff":{}}')],
  ...over,
})

describe('the stored recording of the example', () => {
  it('is read from this app\'s own file on the replays branch', () => {
    expect(REPLAY_URL).toBe('https://raw.githubusercontent.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/replays/app-13-langgraph-map-reduce.json')
  })

  it('names the document it analyzed, from its first request', () => {
    const parsed = parseRecording(recording())
    expect(parsed).not.toBeNull()
    expect(recordedText(parsed!)).toBe('The article.')
  })

  it('names no document when the first request has no readable text', () => {
    for (const body of [null, 'not json', '{"text":5}', '{}']) {
      const parsed = parseRecording(recording({ exchanges: [exchange('/api/run', body)] }))
      expect(recordedText(parsed!)).toBeNull()
    }
  })

  it('is never replayed when malformed or older than three days', () => {
    expect(parseRecording({ version: 1 })).toBeNull()
    expect(parseRecording(recording({ exchanges: [] }))).toBeNull()
    const old = parseRecording(recording({ recorded_at: new Date(Date.now() - 4 * 86_400_000).toISOString() }))!
    expect(isStale(old, Date.now())).toBe(true)
    expect(isStale(parseRecording(recording())!, Date.now())).toBe(false)
  })

  it('is switched off by ?replay=off, which the recorder uses', () => {
    expect(replayDisabled('?replay=off')).toBe(true)
    expect(replayDisabled('')).toBe(false)
    expect(replayDisabled('?replay=on')).toBe(false)
  })

  it('is allowed through the page policy', () => {
    const toml = readFileSync('netlify.toml', 'utf8')
    expect(toml).toMatch(/connect-src[^"]*https:\/\/raw\.githubusercontent\.com/)
  })
})

describe('the status dot inside a badge', () => {
  it('only follows the badge text when it has no state of its own', () => {
    const css = readFileSync('src/styles/tokens.css', 'utf8')
    expect(css).toContain('.ds-badge .ds-dot:not([class*="ds-dot--"]) { background: currentColor; }')
    expect(css).not.toMatch(/\.ds-badge \.ds-dot \{ background: currentColor; \}/)
  })
})
