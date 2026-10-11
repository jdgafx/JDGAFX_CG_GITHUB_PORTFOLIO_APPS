import { describe, expect, it } from 'vitest'
import { IDLE_RUN, type RunState } from '../../src/lib/run'
import { badgeFor, drawSentences, lanes, modelChip, readingNote, statusLine } from '../../src/lib/view'

const running = (over: Partial<RunState>): RunState => ({ ...IDLE_RUN, outcome: 'running', stage: 'thinking', ...over })

describe('badgeFor', () => {
  it('names the stage while running, and uses success only for a finished answer', () => {
    expect(badgeFor(running({ stage: 'answering' }), true)).toMatchObject({ label: 'Answering', tone: 'accent' })
    expect(badgeFor({ ...IDLE_RUN, outcome: 'done' }, true)).toMatchObject({ label: 'Answered', tone: 'success' })
    expect(badgeFor({ ...IDLE_RUN, outcome: 'failed' }, true)).toMatchObject({ label: 'Failed', tone: 'danger' })
    expect(badgeFor({ ...IDLE_RUN, outcome: 'stopped' }, true)).toMatchObject({ label: 'Stopped', tone: 'warning' })
    expect(badgeFor(IDLE_RUN, true)).toMatchObject({ label: 'Ready', tone: 'muted' })
    expect(badgeFor(IDLE_RUN, false).label).toBe('Text only')
  })
})

describe('statusLine', () => {
  it('says there is no voice while the text streams, and points to the answer panel on failure', () => {
    expect(statusLine(running({ stage: 'answering', voice: 'none' }), true)).toContain('no voice')
    expect(statusLine({ ...IDLE_RUN, outcome: 'failed' }, true)).toBe('Failed. The answer panel says why.')
  })
})

describe('modelChip', () => {
  const served = { model: 'anthropic/claude-haiku-5.5', newestModel: 'anthropic/claude-haiku-5.5' }

  it('shows the served id and "newest" when it matches the newest model', () => {
    expect(modelChip({ ...served, modelCheck: 'match' })).toEqual({ label: 'claude-haiku-5.5', marker: '· newest', warn: false, title: served.model })
  })

  it('shows a short warning marker, with the newest id in the title, when the reply came from another model', () => {
    expect(modelChip({ model: 'anthropic/claude-haiku-4.5', newestModel: 'anthropic/claude-haiku-5.5', modelCheck: 'mismatch' })).toEqual({
      label: 'claude-haiku-4.5',
      marker: '· not newest',
      warn: true,
      title: 'anthropic/claude-haiku-4.5, newest: anthropic/claude-haiku-5.5',
    })
  })

  it('shows "unchecked" when the newest model could not be read', () => {
    expect(modelChip({ model: served.model, newestModel: null, modelCheck: 'unchecked' })).toEqual({
      label: 'claude-haiku-5.5',
      marker: '· unchecked',
      warn: false,
      title: served.model,
    })
  })

  it('shows "not reported" with no extra marker when the reply named no model', () => {
    expect(modelChip({ model: undefined, newestModel: served.newestModel, modelCheck: 'not-reported' })).toEqual({
      label: 'not reported',
      marker: '',
      warn: false,
      title: 'The reply named no model',
    })
  })
})

describe('drawSentences', () => {
  it('marks the sentence being spoken and the ones already spoken', () => {
    const drawn = drawSentences({ sentences: ['A.', 'B.', 'C.'], active: 1, spoken: 1, voice: 'speaking' })
    expect(drawn.map(s => s.state)).toEqual(['spoken', 'active', 'waiting'])
  })

  it('marks nothing as spoken when there is no voice', () => {
    expect(drawSentences({ sentences: ['A.'], active: -1, spoken: 0, voice: 'none' })[0].state).toBe('waiting')
  })
})

describe('readingNote', () => {
  it('states the reading slot, the refresh interval and the fetch time for a weather step', () => {
    const note = readingNote({
      detail: 'Lisbon, Lisbon District, Portugal: 21.1 °C, clear sky',
      reading: { time: '2026-10-09T19:15', zone: 'Europe/Lisbon', abbreviation: 'GMT+1', intervalSeconds: 900, fetchedAt: '2026-10-09T18:20:03.000Z' },
    })
    expect(note).toBe('Lisbon, Lisbon District, Portugal: Open-Meteo reading for 19:15 local time (GMT+1), refreshed every 15 minutes. Fetched at 18:20 UTC.')
  })

  it('is null for a step with no reading', () => {
    expect(readingNote({ detail: 'Ada Lovelace' })).toBeNull()
  })
})

describe('lanes', () => {
  it('lays steps end to end and starts parallel tool calls together', () => {
    const out = lanes([
      { ms: 100 },
      { ms: 200 },
      { ms: 300, call: 'weather("Tokyo")' },
      { ms: 500, call: 'weather("Oslo")' },
      { ms: 200 },
    ])
    // Total 100 + 200 + max(300, 500) + 200 = 1000.
    expect(out.map(l => [l.left, l.width])).toEqual([
      [0, 10],
      [10, 20],
      [30, 30],
      [30, 50],
      [80, 20],
    ])
  })
})
