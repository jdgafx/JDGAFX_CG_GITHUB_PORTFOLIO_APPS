import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { recordedQuery, REPLAY_URL, replayDisabled } from '../../src/lib/useReplay'
import { TRY_IT } from '../../src/lib/howto'
import { isStale, parseRecording } from '../../src/replay'

const exchange = (path: string, body: string | null, type = 'text/event-stream; charset=utf-8') => ({
  method: 'POST',
  path,
  request_body: body,
  status: 200,
  headers: { 'content-type': type },
  t_start: 0,
  t_headers: 10,
  t_end: 20,
  chunks: [{ t: 15, text: 'data: [DONE]\n\n' }],
})

const recording = (over: Record<string, unknown> = {}) => ({
  version: 1,
  app: 'app-01-multi-agent-orchestrator',
  url: 'https://example.netlify.app/',
  recorded_at: new Date().toISOString(),
  reported: { model: 'anthropic/claude-haiku-5.5', model_role: 'written by', cost_usd: 0.012, cost_scope: 'research and audit' },
  exchanges: [exchange('/api/ai', JSON.stringify({ query: TRY_IT.question })), exchange('/api/audit', '{"report":"r","sources":[]}', 'application/json')],
  ...over,
})

describe('the stored recording of the example', () => {
  it("is read from this app's own file on the replays branch", () => {
    expect(REPLAY_URL).toBe('https://raw.githubusercontent.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/replays/app-01-multi-agent-orchestrator.json')
  })

  it('names the question it researched, from its first request', () => {
    const parsed = parseRecording(recording())
    expect(parsed).not.toBeNull()
    expect(recordedQuery(parsed!)).toBe(TRY_IT.question)
  })

  it('names no question when the first request has no readable query', () => {
    for (const body of [null, 'not json', '{"query":5}', '{}']) {
      const parsed = parseRecording(recording({ exchanges: [exchange('/api/ai', body)] }))
      expect(recordedQuery(parsed!)).toBeNull()
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
