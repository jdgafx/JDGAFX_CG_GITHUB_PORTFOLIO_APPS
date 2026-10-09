import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReplyVoice } from '../../src/lib/replyVoice'
import { IDLE_RUN, answerText, runReducer, type RunAction, type RunState } from '../../src/lib/run'
import type { SynthLike, UtteranceLike } from '../../src/lib/speechQueue'

class FakeSynth implements SynthLike {
  spoken: UtteranceLike[] = []
  cancelled = 0
  speak(u: UtteranceLike) {
    this.spoken.push(u)
  }
  cancel() {
    this.cancelled += 1
  }
  resume() {}
  getVoices() {
    return [{}]
  }
}

function setup(synth: SynthLike | null = new FakeSynth()) {
  let clock = 1000
  let run: RunState = runReducer(IDLE_RUN, { type: 'start', id: 1, via: 'text', question: 'q', now: 1000 })
  const actions: RunAction[] = []
  const voice = createReplyVoice(
    action => {
      actions.push(action)
      run = runReducer(run, action)
    },
    { synth, makeUtterance: text => ({ text, onstart: null, onend: null, onerror: null, onboundary: null }), now: () => clock },
  )
  return { voice, tick: (ms: number) => (clock += ms), state: () => run, actions, synth }
}

afterEach(() => vi.useRealTimers())

describe('createReplyVoice', () => {
  it('speaks the first sentence while the rest is still streaming, and highlights it when the voice starts', () => {
    const { voice, tick, state, synth } = setup()
    voice.push('It is 21.9 degrees ')
    expect(state().marks.firstTokenAt).toBe(1000)
    expect((synth as FakeSynth).spoken).toEqual([])
    tick(50)
    voice.push('and clear. It feels like 19')
    expect((synth as FakeSynth).spoken.map(u => u.text)).toEqual(['It is 21.9 degrees and clear.'])
    expect(state().marks.firstSentenceAt).toBe(1050)

    tick(40)
    ;(synth as FakeSynth).spoken[0].onstart?.()
    expect(state().active).toBe(0)
    expect(state().marks.speechStartAt).toBe(1090)
    expect(answerText(state())).toBe('It is 21.9 degrees and clear. It feels like 19')

    tick(10)
    voice.push(' degrees.')
    voice.finish()
    expect((synth as FakeSynth).spoken.map(u => u.text)).toEqual(['It is 21.9 degrees and clear.', 'It feels like 19 degrees.'])
  })

  it('speaks sentences without their markdown marks but shows them as written', () => {
    const { voice, state, synth } = setup()
    voice.push('It is **warm** today. ')
    expect((synth as FakeSynth).spoken[0].text).toBe('It is warm today.')
    expect(state().sentences).toEqual(['It is **warm** today.'])
  })

  it('stops everything on cancel and ignores text that arrives afterwards', () => {
    const { voice, actions, synth } = setup()
    voice.push('One. Two. ')
    const before = actions.length
    voice.cancel()
    voice.push('Three. ')
    voice.finish()
    expect((synth as FakeSynth).cancelled).toBe(1)
    expect((synth as FakeSynth).spoken).toHaveLength(2)
    expect(actions.length).toBe(before)
  })

  it('shows the text and reports no voice once when the browser has none', () => {
    const { voice, state, actions } = setup(null)
    voice.push('Hello there. How are you')
    voice.finish()
    expect(actions.filter(a => a.type === 'no-voice')).toHaveLength(1)
    expect(state().voice).toBe('none')
    expect(answerText(state())).toBe('Hello there. How are you')
  })

  it('finishes the run when the voice goes idle after the server is done', () => {
    const { voice, state, synth } = setup()
    voice.push('Only one sentence.')
    voice.finish()
    const utterance = (synth as FakeSynth).spoken[0]
    utterance.onstart?.()
    utterance.onend?.()
    const final = runReducer(state(), { type: 'stream-done', now: 2000 })
    expect(final.outcome).toBe('done')
    expect(final.spoken).toBe(1)
  })

  it('speaks a sentence that ends the text so far once the stream goes quiet, without waiting for the next word', () => {
    vi.useFakeTimers()
    const { voice, synth } = setup()
    voice.push('Let me check the weather in Lisbon.')
    expect((synth as FakeSynth).spoken).toEqual([])
    vi.advanceTimersByTime(250)
    expect((synth as FakeSynth).spoken.map(u => u.text)).toEqual(['Let me check the weather in Lisbon.'])
  })

  it('does not settle while text keeps arriving', () => {
    vi.useFakeTimers()
    const { voice, synth } = setup()
    voice.push('It is 16.')
    vi.advanceTimersByTime(200)
    voice.push('8 degrees. ')
    vi.advanceTimersByTime(1000)
    expect((synth as FakeSynth).spoken.map(u => u.text)).toEqual(['It is 16.8 degrees.'])
  })

  it('speaks the unfinished piece when the model goes off to call a tool', () => {
    const { voice, synth } = setup()
    voice.push('Let me check the weather in Lisbon')
    voice.segmentEnd()
    expect((synth as FakeSynth).spoken.map(u => u.text)).toEqual(['Let me check the weather in Lisbon'])
  })
})
