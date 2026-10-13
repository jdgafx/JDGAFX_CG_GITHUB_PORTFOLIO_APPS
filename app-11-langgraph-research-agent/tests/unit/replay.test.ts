import { describe, expect, it } from 'vitest'
import { REPLAY_URL, recordedQuestion, replayDisabled } from '../../src/lib/useReplay'
import { TRY_IT } from '../../src/lib/howto'
import type { Recording } from '../../src/replay'

const recording = (exchanges: unknown[]) => ({ exchanges }) as unknown as Recording

describe('recordedQuestion', () => {
  it('reads the question from the first /api/run request', () => {
    const body = JSON.stringify({ question: TRY_IT.question })
    expect(recordedQuestion(recording([{ method: 'POST', path: '/api/run', request_body: body }]))).toBe(TRY_IT.question)
  })

  it('is null when the recording has no run request, no body, or a body without a text question', () => {
    expect(recordedQuestion(recording([]))).toBeNull()
    expect(recordedQuestion(recording([{ method: 'POST', path: '/api/run', request_body: null }]))).toBeNull()
    expect(recordedQuestion(recording([{ method: 'POST', path: '/api/run', request_body: 'not json' }]))).toBeNull()
    expect(recordedQuestion(recording([{ method: 'POST', path: '/api/run', request_body: '{"question":3}' }]))).toBeNull()
    expect(recordedQuestion(recording([{ method: 'POST', path: '/api/resume', request_body: '{"question":"x"}' }]))).toBeNull()
  })
})

describe('replay switches', () => {
  it('?replay=off turns the replay off and nothing else does', () => {
    expect(replayDisabled('?replay=off')).toBe(true)
    expect(replayDisabled('')).toBe(false)
    expect(replayDisabled('?replay=on')).toBe(false)
  })

  it('reads the recording of this app from the replays branch', () => {
    expect(REPLAY_URL).toBe('https://raw.githubusercontent.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/replays/app-11-langgraph-research-agent.json')
  })
})
