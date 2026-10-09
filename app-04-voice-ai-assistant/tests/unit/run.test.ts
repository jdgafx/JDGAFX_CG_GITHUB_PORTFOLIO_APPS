import { describe, expect, it } from 'vitest'
import type { TraceStep } from '../../src/lib/api'
import { IDLE_RUN, answerText, runReducer, type RunAction, type RunState } from '../../src/lib/run'

const step = (name: string, detail = '', extra: Partial<TraceStep> = {}): TraceStep => ({ name, status: 'ok', ms: 10, detail, ...extra })

function play(actions: RunAction[], from: RunState = IDLE_RUN): RunState {
  return actions.reduce(runReducer, from)
}

const START: RunAction = { type: 'start', id: 1, via: 'text', question: 'weather in Lisbon?', now: 1000 }

describe('runReducer', () => {
  it('runs a typed question with a tool: marks, sentences, speech start, then done when the voice ends', () => {
    const run = play([
      START,
      { type: 'step', step: step('request built'), now: 1010 },
      { type: 'step', step: step('model call', 'asked for weather'), now: 2300 },
      { type: 'step', step: step('tool call', '', { call: 'weather("Lisbon")' }), now: 2850 },
      { type: 'text', sentences: [], rest: 'It is 21.9 degrees', now: 3900 },
      { type: 'text', sentences: ['It is 21.9 degrees and clear.'], rest: ' It feels', now: 3920 },
      { type: 'speech-start', index: 0, now: 4010 },
    ])
    expect(run.outcome).toBe('running')
    expect(run.stage).toBe('answering')
    expect(run.marks).toMatchObject({ origin: 1000, toolsStartAt: 2300, toolsEndAt: 2850, firstTokenAt: 3900, firstSentenceAt: 3920, speechStartAt: 4010 })
    expect(run.active).toBe(0)
    expect(run.voice).toBe('speaking')
    expect(answerText(run)).toBe('It is 21.9 degrees and clear. It feels')

    const finished = play(
      [
        { type: 'text', sentences: ['It feels like 19.'], rest: '', now: 4100 },
        { type: 'stream-done', model: 'm', totalMs: 3000, now: 4110 },
      ],
      run,
    )
    // The server is done but the voice still has sentences to read.
    expect(finished.outcome).toBe('running')
    expect(finished.stage).toBe('speaking')

    const done = play([{ type: 'speech-end', index: 0 }, { type: 'speech-end', index: 1 }, { type: 'voice-idle', now: 6010 }], finished)
    expect(done.outcome).toBe('done')
    expect(done.spoken).toBe(2)
    expect(done.steps.at(-1)).toMatchObject({ name: 'speak reply', status: 'ok', ms: 2000, detail: 'Read aloud by the browser, 2 sentences' })
  })

  it('ends at once with a skipped speak step when this device has no voice, and keeps the text', () => {
    const run = play([
      START,
      { type: 'text', sentences: ['Hello there.'], rest: '', now: 1500 },
      { type: 'no-voice', now: 1501 },
      { type: 'stream-done', now: 1600 },
    ])
    expect(run.outcome).toBe('done')
    expect(run.voice).toBe('none')
    expect(run.marks.speechStartAt).toBeUndefined()
    expect(run.steps.at(-1)).toMatchObject({ name: 'speak reply', status: 'skipped' })
    expect(answerText(run)).toBe('Hello there.')
  })

  it('treats Stop mid-stream as stopped, keeps the partial text, and notes the voice was stopped', () => {
    const run = play([
      START,
      { type: 'text', sentences: ['First sentence.'], rest: ' Second', now: 1500 },
      { type: 'speech-start', index: 0, now: 1520 },
      { type: 'stop', now: 2000 },
    ])
    expect(run.outcome).toBe('stopped')
    expect(run.active).toBe(-1)
    expect(answerText(run)).toBe('First sentence. Second')
    expect(run.steps.at(-1)).toMatchObject({ name: 'speak reply', status: 'skipped', detail: 'Stopped by you', ms: 480 })
  })

  it('treats Stop after the server finished as a finished answer with a silenced voice', () => {
    const run = play([
      START,
      { type: 'text', sentences: ['A.', 'B.'], rest: '', now: 1500 },
      { type: 'speech-start', index: 0, now: 1520 },
      { type: 'stream-done', now: 1600 },
      { type: 'stop', now: 1800 },
    ])
    expect(run.outcome).toBe('done')
    expect(run.steps.at(-1)).toMatchObject({ detail: 'Stopped by you' })
  })

  it('does not stop a run that has not started', () => {
    expect(runReducer(IDLE_RUN, { type: 'stop', now: 1 })).toBe(IDLE_RUN)
  })

  it('starts the clock for a voice question when the speech ends, not when recording starts', () => {
    const run = play([
      { type: 'start', id: 2, via: 'voice', question: '', now: 100 },
      { type: 'heard', now: 5000 },
      { type: 'transcript', text: 'What is the weather in Paris?', now: 5800 },
    ])
    expect(run.stage).toBe('thinking')
    expect(run.marks).toMatchObject({ origin: 5000, transcriptAt: 5800 })
    expect(run.question).toBe('What is the weather in Paris?')
  })

  it('fails with the message, the time spent and the partial text kept', () => {
    const run = play([START, { type: 'text', sentences: ['Partial.'], rest: '', now: 1200 }, { type: 'fail', message: 'The connection stopped answering.', totalMs: 900 }])
    expect(run).toMatchObject({ outcome: 'failed', error: 'The connection stopped answering.', totalMs: 900 })
    expect(answerText(run)).toBe('Partial.')
  })

  it('does not set the first-token mark from an empty flush', () => {
    const run = play([START, { type: 'text', sentences: [], rest: '', now: 1500 }])
    expect(run.marks.firstTokenAt).toBeUndefined()
  })

  it('clears everything', () => {
    expect(play([START, { type: 'clear' }])).toBe(IDLE_RUN)
  })
})
