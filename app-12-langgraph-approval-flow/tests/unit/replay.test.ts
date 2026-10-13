import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { recordedIssue, REPLAY_URL, replayDisabled } from '../../src/lib/useReplay'
import { isStale, parseRecording } from '../../src/replay'
import { issue as makeIssue } from '../helpers/issues'

const issue = (over: Record<string, unknown> = {}) => ({ ...makeIssue(), ...over })

const exchange = (method: string, path: string, body: string | null) => ({
  method,
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
  app: 'app-12-langgraph-approval-flow',
  url: 'https://example.netlify.app/',
  recorded_at: new Date().toISOString(),
  reported: { model: 'anthropic/claude-haiku-5.5', model_role: 'triaged with', cost_usd: 0.004, cost_scope: 'up to the approval gate' },
  exchanges: [exchange('POST', '/api/start', JSON.stringify({ issue: issue() })), exchange('GET', '/api/threads', null)],
  ...over,
})

describe('the stored recording of the example', () => {
  it("is read from this app's own file on the replays branch", () => {
    expect(REPLAY_URL).toBe('https://raw.githubusercontent.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/replays/app-12-langgraph-approval-flow.json')
  })

  it('names the issue it triaged, from its start request', () => {
    const parsed = parseRecording(recording())
    expect(parsed).not.toBeNull()
    expect(recordedIssue(parsed!)).toEqual(issue())
  })

  it('names no issue when the start request has none that the page would send', () => {
    for (const body of [null, 'not json', '{}', '{"issue":5}', JSON.stringify({ issue: issue({ htmlUrl: 'https://evil.example/x' }) }), JSON.stringify({ issue: issue({ number: 0 }) })]) {
      const parsed = parseRecording(recording({ exchanges: [exchange('POST', '/api/start', body)] }))
      expect(recordedIssue(parsed!)).toBeNull()
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

describe('the approval in a replay', () => {
  it('cannot be sent: the card turns every answer off and the page ignores a decision', () => {
    const card = readFileSync('src/components/ApprovalCard.tsx', 'utf8')
    expect(card).toContain('const off = busy || replay')
    expect(card).not.toMatch(/disabled=\{busy\}/)
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toMatch(/const handleDecide[\s\S]{0,200}if \(replaying\) return/)
  })
})
