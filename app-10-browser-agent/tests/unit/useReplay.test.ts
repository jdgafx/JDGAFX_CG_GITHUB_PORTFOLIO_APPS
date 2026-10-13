import { describe, expect, it } from 'vitest'
import type { Recording } from '../../src/replay'
import { recordedTask, replayDisabled } from '../../src/lib/useReplay'

const exchange = (path: string, body: string | null) => ({
  method: 'POST', path, request_body: body, status: 200, headers: {}, t_start: 0, t_headers: 1, t_end: 2, chunks: [],
})
const recording = (exchanges: Recording['exchanges']): Recording => ({
  version: 1, app: 'app-10-browser-agent', url: 'https://x.test/', recorded_at: '2026-10-13T00:00:00Z',
  reported: { model: 'm', model_role: 'planned by', cost_usd: 0.001, cost_scope: 'planner call' }, exchanges,
})

describe('recordedTask', () => {
  it('is the task of the recorded planner request', () => {
    expect(recordedTask(recording([exchange('/api/ai', '{"task":"Open news.ycombinator.com"}'), exchange('/api/execute', '{"steps":[]}')]))).toBe('Open news.ycombinator.com')
  })

  it('is null when the recording has no usable planner request', () => {
    expect(recordedTask(recording([exchange('/api/execute', '{"steps":[]}')]))).toBeNull()
    expect(recordedTask(recording([exchange('/api/ai', 'not json')]))).toBeNull()
    expect(recordedTask(recording([exchange('/api/ai', '{"task":"  "}')]))).toBeNull()
    expect(recordedTask(recording([exchange('/api/ai', null)]))).toBeNull()
  })
})

describe('replayDisabled', () => {
  it('is on only for ?replay=off', () => {
    expect(replayDisabled('?replay=off')).toBe(true)
    expect(replayDisabled('')).toBe(false)
    expect(replayDisabled('?replay=on')).toBe(false)
  })
})
