import { describe, expect, it } from 'vitest'
import { MODE_LABELS, MODES } from '../../src/lib/modes'

describe('analysis modes', () => {
  it('lists the four modes in order with their labels', () => {
    expect(MODES.map(mode => [mode.id, mode.label])).toEqual([
      ['describe', 'Describe'],
      ['analyze', 'Analyze'],
      ['qa', 'Question'],
      ['extract', 'Extract'],
    ])
  })

  it('gives every mode a hint and matches the label lookup table', () => {
    for (const mode of MODES) {
      expect(mode.hint.length).toBeGreaterThan(0)
      expect(MODE_LABELS[mode.id]).toBe(mode.label)
    }
  })
})
