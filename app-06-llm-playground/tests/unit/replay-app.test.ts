import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogueResponse, CompareRequest } from '../../netlify/shared/contract'
import { BlindAnswers } from '../../src/components/BlindAnswers'
import { Header } from '../../src/components/Header'
import { AnswersSection } from '../../src/components/AnswersSection'
import { RunTotalsStrip } from '../../src/components/RunTotals'
import { JudgeCard } from '../../src/components/JudgeCard'
import { ReplayLabel } from '../../src/components/ReplayLabel'
import { runCompare, runJudge } from '../../src/lib/api'
import { DEFAULT_PICKS, startedRun, statusLine, traceSteps } from '../../src/lib/run'
import { compareRequest } from '../../src/lib/useArena'
import { recordsThisRun, replayDisabled, requestMatches, REPLAY_URL } from '../../src/lib/useReplay'
import { installReplayShim } from '../../src/replay'
import { stubFetch } from '../helpers'
import { COMPARE_BODY, JUDGE_BODY, NOW, recording } from '../replay-fixture'

const input = { mode: 'blind' as const, prompt: 'p', system: '', temperature: null, models: ['m1', 'm2'] as [string, string] }
const catalogue = { source: 'live', fetchedAt: null, defaultModel: 'm0', groups: [] } as CatalogueResponse

function recordingOf(request: CompareRequest) {
  const rec = recording()
  rec.exchanges[0] = { ...rec.exchanges[0], request_body: JSON.stringify(request) }
  return rec
}

describe('replay through the app\'s own client', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('feeds the recorded replies through runCompare and runJudge, with no request to the network', async () => {
    const network = stubFetch(async () => Response.json({ real: true }))
    const request = compareRequest('m0', input)
    const rec = recordingOf(request)
    rec.exchanges[1] = { ...rec.exchanges[1], request_body: JSON.stringify({ prompt: 'p', answers: [{ slot: 'A', text: 'alpha' }] }) }
    installReplayShim(rec, { target: globalThis, origin: 'http://app.test', speed: 1, requestMatches })
    const compare = runCompare(request)
    await vi.advanceTimersByTimeAsync(4100)
    expect(await compare).toEqual(COMPARE_BODY)
    const judge = runJudge({ prompt: 'p', answers: [{ slot: 'A', text: 'alpha' }] })
    await vi.advanceTimersByTimeAsync(2900)
    expect(await judge).toEqual(JUDGE_BODY)
    expect(network).not.toHaveBeenCalled()
    expect(globalThis.fetch).toBe(network)
  })

  it('does not answer anything once the replay is over: a later call is a real request', async () => {
    const network = stubFetch(async () => Response.json({ real: true }))
    const shim = installReplayShim(recording(), { target: globalThis, origin: 'http://app.test', speed: 1 })
    shim.stop()
    await runCompare(compareRequest('m0', input))
    expect(network).toHaveBeenCalledTimes(1)
  })
})

describe('replay glue', () => {
  it('reads the recording from the fixed public URL on the replays branch', () => {
    expect(REPLAY_URL).toBe('https://raw.githubusercontent.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/replays/app-06-llm-playground.json')
  })

  it('is switched off by ?replay=off, which the recorder uses', () => {
    expect(replayDisabled('?replay=off')).toBe(true)
    expect(replayDisabled('')).toBe(false)
    expect(replayDisabled('?replay=on')).toBe(false)
  })

  it('replays only a recording of the run Try it would start now', () => {
    const rec = recordingOf(compareRequest('m0', input))
    expect(recordsThisRun(rec, catalogue, input)).toBe(true)
    // The server ignores the first model, so a new default model does not invalidate the recording.
    expect(recordsThisRun(rec, { ...catalogue, defaultModel: 'newer' }, input)).toBe(true)
    expect(recordsThisRun(rec, catalogue, { ...input, models: ['m1', 'other'] })).toBe(false)
    expect(recordsThisRun(rec, catalogue, { ...input, prompt: 'different' })).toBe(false)
    expect(recordsThisRun(recording({ exchanges: [recording().exchanges[1]] }), catalogue, input)).toBe(false)
  })

  it('compares other requests exactly', () => {
    expect(requestMatches('{"a":1}', '{"a":1}', '/api/judge')).toBe(true)
    expect(requestMatches('{"a":1}', '{"a":2}', '/api/judge')).toBe(false)
    expect(requestMatches(null, null, '/api/leaderboard')).toBe(true)
    expect(requestMatches('{"models":[1,2,3]}', 'nope', '/api/compare')).toBe(false)
  })

  it('shows the label from the recording and a Run it live button', () => {
    const html = renderToStaticMarkup(ReplayLabel({ info: { recording: recording(), speed: 1.5, startedAt: NOW }, onRunLive: () => {}, disabled: false }))
    expect(html).toContain('Replay of a real run')
    expect(html).toContain('2 h ago')
    expect(html).toContain('judged by anthropic/claude-test')
    expect(html).toContain('judge call $0.000412')
    expect(html).toContain('Shown at 1.5x speed; the real run took 7.0 s.')
    expect(html).toMatch(/<button[^>]*>Run it live<\/button>/)
  })
})

describe('a replay never votes', () => {
  const blind = { ...COMPARE_BODY, answers: [{ label: 'A', ok: true, error: null, text: 'alpha', finishReason: 'stop' }] } as never

  it('disables every vote button on a replayed run and says why', () => {
    const html = renderToStaticMarkup(BlindAnswers({ blind, vote: { state: 'idle' }, onVote: () => {}, replay: true }))
    const buttons = html.match(/<button[^>]*>/g) ?? []
    expect(buttons.length).toBeGreaterThanOrEqual(3)
    for (const button of buttons) expect(button).toContain('disabled=""')
    expect(html).toContain('This is a replay, so voting is off')
  })

  it('leaves the vote buttons live for a visitor\'s own run', () => {
    const html = renderToStaticMarkup(BlindAnswers({ blind, vote: { state: 'idle' }, onVote: () => {}, replay: false }))
    expect(html).not.toContain('This is a replay')
    expect(html).toMatch(/<button[^>]*>Panel A is best<\/button>/)
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Panel A is best/)
  })

  it('returns from vote() before any request when the run is a replay', () => {
    const source = readFileSync('src/lib/useArena.ts', 'utf8')
    const vote = source.slice(source.indexOf('async function vote'), source.indexOf('function stop'))
    expect(vote.indexOf('run?.replay')).toBeGreaterThan(-1)
    expect(vote.indexOf('run?.replay')).toBeLessThan(vote.indexOf('runVote('))
  })

  it('starts the replay without a vote call anywhere in the replay code', () => {
    for (const file of ['src/lib/useReplay.ts', 'src/replay/shim.ts', 'src/replay/recording.ts']) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/runVote|api\/vote/)
    }
  })
})

describe('judge panel and status pill in a replay', () => {
  const live = { state: 'idle' as const, label: 'x', title: 'x' }
  it('says the opinion and panel identities are not shown, instead of promising them after a vote', () => {
    const html = renderToStaticMarkup(JudgeCard({ judge: { state: 'running' }, compare: null, held: true, replay: true }))
    expect(html).toContain('not shown in a replay')
    expect(html).not.toContain('appears after you vote')
    expect(html).not.toContain('is reading the answers')
  })

  it('keeps the held message for a visitor\'s own blind run', () => {
    const html = renderToStaticMarkup(JudgeCard({ judge: { state: 'running' }, compare: null, held: true }))
    expect(html).toContain('appears after you vote')
  })

  it('gives the pill a replay state, never "Your vote"', () => {
    const run = { ...startedRun('blind', 'p'), status: 'voting' as const, replay: true as const }
    const html = renderToStaticMarkup(Header({ catalogue: null, catalogueFailed: false, run, live }))
    expect(html).toContain('Replay, votes off')
    expect(html).not.toContain('Your vote')
    const own = renderToStaticMarkup(Header({ catalogue: null, catalogueFailed: false, run: { ...run, replay: undefined }, live }))
    expect(own).toContain('Your vote')
  })
})

describe('every vote-related text in a replay says votes are off', () => {
  const blind = { ...COMPARE_BODY, answers: [{ label: 'A', ok: true, error: null, text: 'alpha', finishReason: 'stop' }] } as never
  const base = { ...startedRun('blind', 'p'), status: 'voting' as const, blind, judge: { state: 'running' as const } }
  const promises = /after your vote|until you vote|when you vote|appears after|Your vote|pick the best/i
  const live = { state: 'idle' as const, label: 'x', title: 'x' }
  const screens = (run: typeof base) => [
    renderToStaticMarkup(AnswersSection({ run, picks: DEFAULT_PICKS, onVote: () => {}, onRetry: () => {}, canRetry: true })),
    renderToStaticMarkup(RunTotalsStrip({ run })),
    renderToStaticMarkup(JudgeCard({ judge: run.judge, compare: null, held: true, replay: run.replay === true })),
    renderToStaticMarkup(Header({ catalogue: null, catalogueFailed: false, run, live })),
    statusLine(run),
    traceSteps(run).map(step => step.detail).join(' '),
  ].join(' ')

  it('never promises a vote, a reveal or the judge after a vote in a replay', () => {
    const text = screens({ ...base, replay: true })
    expect(text).not.toMatch(promises)
    expect(text).toContain('Voting is off')
    expect(text).toContain('Not shown in a replay')
  })

  it('keeps those words for a visitor\'s own blind run', () => {
    const text = screens(base)
    expect(text).toMatch(/after your vote/i)
    expect(text).toMatch(/until you vote/i)
    expect(text).toContain('Your vote')
  })
})

describe('defaults', () => {
  it('uses the same default picks as Try it', () => {
    expect(DEFAULT_PICKS.B).toBeTruthy()
  })
})
