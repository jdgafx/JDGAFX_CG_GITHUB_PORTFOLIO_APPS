import { describe, expect, it } from 'vitest'
import { parseInline } from '../../src/lib/markdown'

describe('parseInline', () => {
  it('reads emphasis, strong and code, and keeps the text around them', () => {
    expect(
      parseInline('The novel *Do Androids Dream of Electric Sheep?* was written by **Philip K. Dick** [1], see `x`.'),
    ).toEqual([
      { kind: 'text', text: 'The novel ' },
      { kind: 'em', text: 'Do Androids Dream of Electric Sheep?' },
      { kind: 'text', text: ' was written by ' },
      { kind: 'strong', text: 'Philip K. Dick' },
      { kind: 'text', text: ' [1], see ' },
      { kind: 'code', text: 'x' },
      { kind: 'text', text: '.' },
    ])
  })

  it('reads underscore emphasis only at word edges, so snake_case stays text', () => {
    expect(parseInline('_Blade Runner_ and snake_case_name')).toEqual([
      { kind: 'em', text: 'Blade Runner' },
      { kind: 'text', text: ' and snake_case_name' },
    ])
  })

  it('leaves citations, lone markers and plain lines untouched', () => {
    expect(parseInline('Built in 1889 [1]. 2 * 3 = 6 and a * b')).toEqual([
      { kind: 'text', text: 'Built in 1889 [1]. 2 * 3 = 6 and a * b' },
    ])
    expect(parseInline('')).toEqual([{ kind: 'text', text: '' }])
  })

  it('never produces markup: tags in the text stay text', () => {
    expect(parseInline('<img src=x onerror=alert(1)> *ok*')).toEqual([
      { kind: 'text', text: '<img src=x onerror=alert(1)> ' },
      { kind: 'em', text: 'ok' },
    ])
  })
})
