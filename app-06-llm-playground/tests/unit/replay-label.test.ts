import { describe, expect, it } from 'vitest'
import { formatAge, playbackSpeed, replayLabel } from '../../src/replay'
import { NOW, recording } from '../replay-fixture'

describe('replay label', () => {
  it('takes age, model and cost from the recording, not from constants', () => {
    const label = replayLabel(recording(), NOW, 1)
    expect(label.age).toBe('2 h ago')
    expect(label.model).toBe('judged by anthropic/claude-test')
    expect(label.cost).toBe('judge call $0.000412')
    const other = recording({ reported: { model: 'vendor/other-1', model_role: 'judge', cost_usd: 0.5, cost_scope: 'judge call' }, recorded_at: new Date(NOW - 26 * 3_600_000).toISOString() })
    const changed = replayLabel(other, NOW, 1)
    expect(changed).toMatchObject({ age: '26 h ago', model: 'judged by vendor/other-1', cost: 'judge call $0.500000' })
  })

  it('states a speed-up only when the replay is faster than the real run', () => {
    expect(replayLabel(recording(), NOW, 1).speedNote).toBeNull()
    expect(replayLabel(recording(), NOW, 2.5).speedNote).toBe('Shown at 2.5x speed; the real run took 7.0 s.')
  })

  it('plays a run of about fifteen seconds or less in real time, and a longer one faster', () => {
    expect(playbackSpeed(recording())).toBe(1)
    const long = recording()
    long.exchanges[1] = { ...long.exchanges[1], t_headers: 25_000, t_end: 25_000, chunks: [{ t: 25_000, text: '{}' }] }
    expect(playbackSpeed(long)).toBe(1.7)
  })

  it('writes ages in plain units', () => {
    expect(formatAge(10_000)).toBe('just now')
    expect(formatAge(5 * 60_000)).toBe('5 min ago')
    expect(formatAge(3 * 86_400_000)).toBe('3 days ago')
  })
})
