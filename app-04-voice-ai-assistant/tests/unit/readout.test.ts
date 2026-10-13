import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Readout from '../../src/components/Readout'
import { IDLE_RUN, runReducer, type RunAction, type RunState } from '../../src/lib/run'
import { readoutParts } from '../../src/lib/ttfa'

const play = (actions: RunAction[]): RunState => actions.reduce(runReducer, IDLE_RUN)
const START: RunAction = { type: 'start', id: 1, via: 'text', question: 'Who was Ada Lovelace?', now: 1000 }

// The text of the readout cell with this label, e.g. "First sentence" -> "500 ms".
function cell(run: RunState, label: string): string | undefined {
  const html = renderToStaticMarkup(createElement(Readout, { run }))
  const match = new RegExp(`${label}</dt><dd[^>]*>([^<]*)</dd>`).exec(html)
  return match?.[1]
}

describe('readout first sentence', () => {
  it('shows the measured time from the start when the first sentence arrives with the first word', () => {
    // One chunk carries the first word and a whole sentence, so the gap between them is 0 ms. That gap is not the figure to show.
    const run = play([START, { type: 'text', sentences: ['Ada Lovelace was a mathematician.'], rest: '', now: 1500 }, { type: 'speech-start', index: 0, now: 1520 }])
    expect(readoutParts(run.marks).firstSentence).toBe(500)
    expect(cell(run, 'First sentence')).toBe('500 ms')
    expect(cell(run, 'First sentence')).not.toBe('0 ms')
  })

  it('shows no figure when no sentence was measured', () => {
    const run = play([START, { type: 'text', sentences: [], rest: 'Ada', now: 1400 }])
    expect(readoutParts(run.marks).firstSentence).toBeUndefined()
    expect(cell(run, 'First sentence')).toBe('—')
  })
})
