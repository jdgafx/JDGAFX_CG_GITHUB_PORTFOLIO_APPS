import { describe, expect, it } from 'vitest'
import type { Recording } from '../../src/replay'
import { recordsThisBrief, replayDisabled } from '../../src/lib/useReplay'

function recording(requestBody: string | null): Recording {
  return {
    version: 1,
    app: 'app-07-content-pipeline',
    url: 'https://example.test/',
    recorded_at: '2026-10-13T10:00:00.000Z',
    reported: { model: 'm', model_role: 'written by', cost_usd: 0.005, cost_scope: 'whole run' },
    exchanges: [{
      method: 'POST', path: '/api/ai?stage=sources', request_body: requestBody, status: 200, headers: {},
      t_start: 0, t_headers: 10, t_end: 20, chunks: [{ t: 20, text: '{}' }],
    }],
  }
}

const sources = JSON.stringify({ topic: 'The Apollo 11 Moon landing', contentType: 'Social Thread', stage: 'sources', context: {} })

describe('recordsThisBrief', () => {
  it('accepts a recording of the same topic and format', () => {
    expect(recordsThisBrief(recording(sources), 'The Apollo 11 Moon landing', 'Social Thread')).toBe(true)
  })

  it('refuses a recording of another topic or format', () => {
    expect(recordsThisBrief(recording(sources), 'Why unit tests matter', 'Social Thread')).toBe(false)
    expect(recordsThisBrief(recording(sources), 'The Apollo 11 Moon landing', 'Newsletter')).toBe(false)
  })

  it('refuses a recording whose first request is missing or unreadable', () => {
    expect(recordsThisBrief(recording(null), 'The Apollo 11 Moon landing', 'Social Thread')).toBe(false)
    expect(recordsThisBrief(recording('not json'), 'The Apollo 11 Moon landing', 'Social Thread')).toBe(false)
  })
})

describe('replayDisabled', () => {
  it('is on only for ?replay=off', () => {
    expect(replayDisabled('?replay=off')).toBe(true)
    expect(replayDisabled('')).toBe(false)
    expect(replayDisabled('?replay=on')).toBe(false)
  })
})
