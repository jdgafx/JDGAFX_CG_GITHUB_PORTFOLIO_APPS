import { describe, expect, it } from 'vitest'
import { approvalVisible, NO_STREAM, runningLine } from '../../src/lib/stream-view'

describe('runningLine', () => {
  it('says the run is starting only before the first event of a new run', () => {
    expect(runningLine(null, NO_STREAM)).toBe('Starting the triage run.')
    expect(runningLine(null, { resuming: false, eventsArrived: true })).toBe('Running the triage.')
  })

  it('names the step while one is running', () => {
    expect(runningLine('classify', { resuming: false, eventsArrived: true })).toBe('Running the classify step.')
  })

  it('says the decision is being sent from the click until the first event of a resume', () => {
    expect(runningLine(null, { resuming: true, eventsArrived: false })).toBe('Sending your decision.')
    expect(runningLine(null, { resuming: true, eventsArrived: true })).toBe('Running the triage.')
    expect(runningLine('reply', { resuming: true, eventsArrived: true })).toBe('Running the reply step.')
  })
})

describe('approvalVisible', () => {
  it('shows the card while paused, and never without a proposal', () => {
    expect(approvalVisible('paused', NO_STREAM, true)).toBe(true)
    expect(approvalVisible('paused', NO_STREAM, false)).toBe(false)
  })

  it('keeps the card, so typed values survive, while a decision is on its way', () => {
    expect(approvalVisible('running', { resuming: true, eventsArrived: false }, true)).toBe(true)
  })

  it('removes the card once the server answered the resume, and for any other run or phase', () => {
    expect(approvalVisible('running', { resuming: true, eventsArrived: true }, true)).toBe(false)
    expect(approvalVisible('running', NO_STREAM, true)).toBe(false)
    expect(approvalVisible('running', { resuming: false, eventsArrived: false }, true)).toBe(false)
    expect(approvalVisible('failed', NO_STREAM, true)).toBe(false)
    expect(approvalVisible('done', NO_STREAM, true)).toBe(false)
    expect(approvalVisible('idle', NO_STREAM, true)).toBe(false)
  })
})
