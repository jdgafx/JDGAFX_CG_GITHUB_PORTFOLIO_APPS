import { describe, expect, it } from 'vitest'
import { MODE_LABELS, MODES, SCOPES, scopeOf } from '../../src/lib/modes'

describe('analysis modes', () => {
  it('lists the four modes in order with their labels', () => {
    expect(MODES.map(mode => [mode.id, mode.label])).toEqual([
      ['describe', 'Describe'],
      ['analyze', 'Analyze'],
      ['qa', 'Question'],
      ['extract', 'Extract'],
    ])
  })

  it('looks a label up by mode id', () => {
    expect(MODE_LABELS).toEqual({
      describe: 'Describe',
      analyze: 'Analyze',
      qa: 'Question',
      extract: 'Extract',
      region: 'Region',
      compare: 'Compare',
    })
  })

  it('groups the six modes into three scopes', () => {
    expect(SCOPES.map(scope => scope.id)).toEqual(['whole', 'region', 'compare'])
    expect(['describe', 'analyze', 'qa', 'extract', 'region', 'compare'].map(mode => scopeOf(mode as never))).toEqual([
      'whole',
      'whole',
      'whole',
      'whole',
      'region',
      'compare',
    ])
  })
})
