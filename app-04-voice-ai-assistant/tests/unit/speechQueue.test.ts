import { describe, expect, it, vi } from 'vitest'
import { createSpeechQueue, type QueueEvents, type SynthLike, type UtteranceLike } from '../../src/lib/speechQueue'

// A speechSynthesis that plays nothing: the test says when each utterance starts, ends or fails.
class FakeSynth implements SynthLike {
  spoken: UtteranceLike[] = []
  cancelled = 0
  resumed = 0
  voices: unknown[] = [{}]
  speak(u: UtteranceLike) {
    this.spoken.push(u)
  }
  cancel() {
    this.cancelled += 1
  }
  resume() {
    this.resumed += 1
  }
  getVoices() {
    return this.voices
  }
}

const makeUtterance = (text: string): UtteranceLike => ({ text, onstart: null, onend: null, onerror: null, onboundary: null })

function setup(synth = new FakeSynth()) {
  const log: string[] = []
  const events: QueueEvents = {
    onStart: i => log.push(`start ${i}`),
    onEnd: i => log.push(`end ${i}`),
    onIdle: () => log.push('idle'),
    onNoVoice: () => log.push('no voice'),
    onFailure: m => log.push(`failure ${m}`),
  }
  return { synth, log, queue: createSpeechQueue(synth, makeUtterance, events) }
}

describe('speech queue', () => {
  it('hands sentences to the voice in order without cancelling the one before', () => {
    const { synth, queue } = setup()
    queue.enqueue('First.')
    queue.enqueue('Second.')
    queue.enqueue('Third.')
    expect(synth.spoken.map(u => u.text)).toEqual(['First.', 'Second.', 'Third.'])
    expect(synth.cancelled).toBe(0)
  })

  it('reports each start and end in order, and idle only after finish and the last end', () => {
    const { synth, log, queue } = setup()
    queue.enqueue('A.')
    queue.enqueue('B.')
    synth.spoken[0].onstart?.()
    synth.spoken[0].onend?.()
    synth.spoken[1].onstart?.()
    queue.finish()
    expect(log).toEqual(['start 0', 'end 0', 'start 1'])
    synth.spoken[1].onend?.()
    expect(log).toEqual(['start 0', 'end 0', 'start 1', 'end 1', 'idle'])
    expect(queue.active()).toBe(false)
  })

  it('is not idle while the reply is still streaming, even when every queued sentence has ended', () => {
    const { synth, log, queue } = setup()
    queue.enqueue('A.')
    synth.spoken[0].onstart?.()
    synth.spoken[0].onend?.()
    expect(log).not.toContain('idle')
    queue.enqueue('B.')
    synth.spoken[1].onstart?.()
    synth.spoken[1].onend?.()
    queue.finish()
    expect(log.at(-1)).toBe('idle')
  })

  it('stop cancels the voice at once and ignores everything the browser says afterwards', () => {
    const { synth, log, queue } = setup()
    queue.enqueue('A.')
    queue.enqueue('B.')
    synth.spoken[0].onstart?.()
    queue.cancel()
    expect(synth.cancelled).toBe(1)
    // The browser reports the cancelled sentences as errors and an end.
    synth.spoken[0].onerror?.({ error: 'canceled' })
    synth.spoken[0].onend?.()
    synth.spoken[1].onstart?.()
    queue.finish()
    expect(log).toEqual(['start 0'])
    expect(queue.active()).toBe(false)
  })

  it('reports no voice once, with no error, when a sentence fails on a device with no voices', () => {
    const synth = new FakeSynth()
    synth.voices = []
    const { log, queue } = setup(synth)
    queue.enqueue('A.')
    queue.enqueue('B.')
    synth.spoken[0].onerror?.({ error: 'synthesis-failed' })
    synth.spoken[1].onerror?.({ error: 'synthesis-failed' })
    expect(log).toEqual(['no voice'])
  })

  it('reports a voice failure in plain words when voices exist but playback breaks', () => {
    const { synth, log, queue } = setup()
    queue.enqueue('A.')
    synth.spoken[0].onerror?.({ error: 'audio-busy' })
    expect(log).toEqual(['failure Voice playback failed. The reply is shown as text.'])
  })

  it('treats a stop requested through the browser as quiet, not as a failure', () => {
    const { synth, log, queue } = setup()
    queue.enqueue('A.')
    synth.spoken[0].onerror?.({ error: 'interrupted' })
    expect(log).toEqual([])
    expect(queue.active()).toBe(true)
  })

  it('gives up on a sentence that never starts and moves to the next, or reports no voice when there are none', () => {
    vi.useFakeTimers()
    try {
      const withVoice = setup()
      withVoice.queue.enqueue('A.')
      withVoice.queue.enqueue('B.')
      vi.advanceTimersByTime(4_000)
      expect(withVoice.log).toEqual(['end 0'])

      const synth = new FakeSynth()
      synth.voices = []
      const noVoice = setup(synth)
      noVoice.queue.enqueue('A.')
      vi.advanceTimersByTime(4_000)
      expect(noVoice.log).toEqual(['no voice'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('ends a sentence whose onend never fires, once word boundaries stop', () => {
    vi.useFakeTimers()
    try {
      const { synth, log, queue } = setup()
      queue.enqueue('A sentence.')
      synth.spoken[0].onstart?.()
      synth.spoken[0].onboundary?.()
      vi.advanceTimersByTime(12_000)
      queue.finish()
      expect(log).toEqual(['start 0', 'end 0', 'idle'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the voice alive with a periodic resume while a sentence is pending', () => {
    vi.useFakeTimers()
    try {
      const { synth, queue } = setup()
      queue.enqueue('word '.repeat(100))
      synth.spoken[0].onstart?.()
      vi.advanceTimersByTime(8_000)
      expect(synth.resumed).toBe(1)
      queue.cancel()
    } finally {
      vi.useRealTimers()
    }
  })
})
