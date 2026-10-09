// Speaks a reply sentence by sentence, in order, while it is still streaming in. The browser's
// speechSynthesis queues utterances itself, so each sentence is handed over as it completes and
// plays after the one before. The queue adds what the browser does not: which sentence is being
// spoken (for the highlight), the moment the first one started (for time to first audio), one Stop
// that cancels everything, and a watchdog per sentence, because `onend` sometimes never fires
// (a backgrounded tab, Chrome's long-utterance cut-off). With no voice installed it reports that once
// and stays quiet, so the text carries on streaming with a note instead of an error.

// Narrow shapes of the browser objects, so the queue is tested with a fake.
export interface UtteranceLike {
  text: string
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onboundary: (() => void) | null
}

export interface SynthLike {
  speak: (utterance: UtteranceLike) => void
  cancel: () => void
  resume: () => void
  getVoices: () => unknown[]
}

export interface QueueEvents {
  /** Sentence `index` started. For index 0 this is the first audio. */
  onStart: (index: number) => void
  /** Sentence `index` finished. */
  onEnd: (index: number) => void
  /** Every sentence was finished and the reply is complete. */
  onIdle: () => void
  /** There is no voice on this device. The text still shows. */
  onNoVoice: () => void
  /** The voice failed. The text still shows. */
  onFailure: (message: string) => void
}

export interface SpeechQueue {
  enqueue: (sentence: string) => number
  /** No more sentences will come. onIdle fires once the last one has finished. */
  finish: () => void
  /** Stops the sentence being spoken and drops the rest. Later browser events are ignored. */
  cancel: () => void
  /** True while a sentence is queued or being spoken. */
  active: () => boolean
}

// A sentence that has not started this long after its turn came is given up on.
const START_GRACE_MS = 4_000
// Once speaking, silence between word boundaries this long counts as finished.
const BOUNDARY_GRACE_MS = 12_000
const MS_PER_CHAR = 90
const MAX_SENTENCE_MS = 60_000
// Chrome pauses long speech when the tab loses focus; a periodic resume keeps playback alive.
const KEEPALIVE_MS = 8_000

interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (id: unknown) => void
}

const REAL_TIMERS: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: id => globalThis.clearTimeout(id as number),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: id => globalThis.clearInterval(id as number),
}

interface Item {
  utterance: UtteranceLike
  started: boolean
  ended: boolean
  chars: number
}

export function createSpeechQueue(
  synth: SynthLike | null,
  makeUtterance: (text: string) => UtteranceLike,
  events: QueueEvents,
  timers: Timers = REAL_TIMERS,
): SpeechQueue {
  const items: Item[] = []
  let current = 0
  let finished = false
  let stopped = synth === null
  let watchdog: unknown
  let keepalive: unknown
  let idleSent = false

  const clearTimers = () => {
    if (watchdog !== undefined) timers.clearTimeout(watchdog)
    if (keepalive !== undefined) timers.clearInterval(keepalive)
    watchdog = undefined
    keepalive = undefined
  }

  const hasVoices = () => {
    try {
      return (synth?.getVoices().length ?? 0) > 0
    } catch {
      return false
    }
  }

  const shutdown = () => {
    stopped = true
    clearTimers()
    try {
      synth?.cancel()
    } catch {
      // Synthesis is already torn down; nothing to cancel.
    }
  }

  const checkIdle = () => {
    if (stopped || idleSent || !finished || current < items.length) return
    idleSent = true
    clearTimers()
    events.onIdle()
  }

  const arm = (ms: number) => {
    if (watchdog !== undefined) timers.clearTimeout(watchdog)
    watchdog = timers.setTimeout(() => {
      const item = items[current]
      if (!item || stopped) return
      // Never started: with no voices that is a missing voice; otherwise skip the sentence.
      if (!item.started && !hasVoices()) {
        shutdown()
        events.onNoVoice()
        return
      }
      end(current)
    }, ms)
  }

  // Starts the clock for the sentence whose turn it is.
  const beginTurn = () => {
    const item = items[current]
    if (!item || stopped) return
    arm(START_GRACE_MS)
    keepalive ??= timers.setInterval(() => {
      try {
        synth?.resume()
      } catch {
        // The watchdog still guarantees a terminal state.
      }
    }, KEEPALIVE_MS)
  }

  const end = (index: number) => {
    const item = items[index]
    if (!item || item.ended || stopped) return
    item.ended = true
    events.onEnd(index)
    if (index === current) {
      current += 1
      if (current < items.length) beginTurn()
      else {
        clearTimers()
        checkIdle()
      }
    }
  }

  return {
    enqueue(sentence) {
      const index = items.length
      const utterance = makeUtterance(sentence)
      const item: Item = { utterance, started: false, ended: false, chars: sentence.length }
      items.push(item)
      if (stopped || !synth) return index
      utterance.onstart = () => {
        if (stopped || item.started) return
        item.started = true
        arm(Math.min(MAX_SENTENCE_MS, START_GRACE_MS + item.chars * MS_PER_CHAR))
        events.onStart(index)
      }
      utterance.onboundary = () => {
        if (!stopped && index === current) arm(BOUNDARY_GRACE_MS)
      }
      utterance.onend = () => end(index)
      utterance.onerror = event => {
        if (stopped) return
        // Cancelling on purpose surfaces as an error event; that is not a failure.
        if (event.error === 'canceled' || event.error === 'interrupted') return
        shutdown()
        if (!hasVoices()) events.onNoVoice()
        else events.onFailure('Voice playback failed. The reply is shown as text.')
      }
      try {
        synth.speak(utterance)
      } catch (err) {
        console.error('speech: synthesis failed to start', err)
        shutdown()
        events.onFailure('Voice playback is unavailable. The reply is shown as text.')
        return index
      }
      if (index === current) beginTurn()
      return index
    },
    finish() {
      finished = true
      checkIdle()
    },
    cancel() {
      if (stopped && items.length === 0) return
      shutdown()
    },
    active: () => !stopped && current < items.length,
  }
}

/** The browser's speechSynthesis, or null where there is none. */
export function browserSynth(): SynthLike | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return null
  return window.speechSynthesis as unknown as SynthLike
}

export function browserUtterance(text: string): UtteranceLike {
  return new SpeechSynthesisUtterance(text) as unknown as UtteranceLike
}
