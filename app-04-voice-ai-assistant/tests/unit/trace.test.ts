import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRecorder } from '../../netlify/shared/trace'

describe('createRecorder', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('times each step from the end of the previous one, so the steps add up to the total', () => {
    const run = createRecorder()

    vi.advanceTimersByTime(120)
    run.add('request built', 'ok', '2 earlier messages, 11 characters')
    vi.advanceTimersByTime(30)
    run.add('model call', 'ok', 'anthropic/claude-haiku-5.5', { tokens: 13, cost: 0.0000123 })

    expect(run.steps).toEqual([
      { name: 'request built', status: 'ok', ms: 120, detail: '2 earlier messages, 11 characters' },
      { name: 'model call', status: 'ok', ms: 30, detail: 'anthropic/claude-haiku-5.5', tokens: 13, cost: 0.0000123 },
    ])
    expect(run.elapsed()).toBe(150)
  })

  it('keeps a step\'s own time and the call and source it carries, and the next step still starts after it', () => {
    const run = createRecorder()

    vi.advanceTimersByTime(100)
    run.add('tool call', 'ok', 'Lisbon: 17.6 °C', { ms: 40, call: 'weather("Lisbon")', source: 'https://api.open-meteo.com/v1/forecast' })
    vi.advanceTimersByTime(25)
    run.add('model answer', 'ok', 'anthropic/claude-haiku-5.5')

    expect(run.steps[0]).toEqual({
      name: 'tool call',
      status: 'ok',
      ms: 40,
      detail: 'Lisbon: 17.6 °C',
      call: 'weather("Lisbon")',
      source: 'https://api.open-meteo.com/v1/forecast',
    })
    expect(run.steps[1]?.ms).toBe(25)
  })

  it('leaves token and cost fields off a step that did not report them', () => {
    const run = createRecorder()

    vi.advanceTimersByTime(5)
    run.add('audio received', 'skipped', 'No speech energy')

    expect(run.steps[0]).toEqual({ name: 'audio received', status: 'skipped', ms: 5, detail: 'No speech energy' })
    expect('tokens' in (run.steps[0] ?? {})).toBe(false)
  })
})
