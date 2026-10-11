import { describe, expect, it } from 'vitest'
import { servedChip } from '../../src/lib/format'

const NEWER = 'anthropic/claude-haiku-5.5'
const SERVED = 'anthropic/claude-haiku-4.5'
const REVIEW = 'Pass 1: review'
const READ1 = 'Pass 2: verify (read 1)'

describe('servedChip', () => {
  it('shows the id with "· newest" on a match, and each call in the title', () => {
    expect(servedChip(NEWER, NEWER, 'match', [{ pass: REVIEW, model: NEWER }])).toEqual({
      text: 'claude-haiku-5.5',
      marker: '· newest',
      warn: false,
      title: `${REVIEW}: ${NEWER}`,
    })
  })

  it('shows "· not newest" in the warning style on a mismatch, with the newest id in the title', () => {
    expect(servedChip(SERVED, NEWER, 'mismatch', [{ pass: REVIEW, model: SERVED }])).toEqual({
      text: 'claude-haiku-4.5',
      marker: '· not newest',
      warn: true,
      title: `${REVIEW}: ${SERVED}, newest: ${NEWER}`,
    })
  })

  it('shows "· not newest" when only a later pass named an older model, and lists both passes', () => {
    const chip = servedChip(NEWER, NEWER, 'mismatch', [
      { pass: REVIEW, model: NEWER },
      { pass: READ1, model: SERVED },
    ])
    expect(chip).toEqual({
      text: 'claude-haiku-5.5',
      marker: '· not newest',
      warn: true,
      title: `${REVIEW}: ${NEWER}, ${READ1}: ${SERVED}, newest: ${NEWER}`,
    })
  })

  it('shows "· unchecked" with no warning when the list gave no answer', () => {
    expect(servedChip(SERVED, null, 'unchecked', [{ pass: REVIEW, model: SERVED }])).toEqual({
      text: 'claude-haiku-4.5',
      marker: '· unchecked',
      warn: false,
      title: `${REVIEW}: ${SERVED}`,
    })
  })

  it('shows "not reported" and nothing extra when no model was named', () => {
    expect(servedChip(null, null, 'not-reported', [])).toEqual({ text: 'not reported', marker: null, warn: false, title: undefined })
  })
})
