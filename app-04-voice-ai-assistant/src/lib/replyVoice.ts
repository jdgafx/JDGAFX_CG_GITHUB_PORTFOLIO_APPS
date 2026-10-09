// Joins the three streaming parts for one reply: the sentence splitter, the speech queue and the run
// state. Text goes in as it streams; completed sentences go to the voice in order, and everything that
// happens (a sentence ready, a voice starting, the voice ending, no voice) comes out as run actions.
import type { RunAction } from './run'
import { createSentenceSplitter, speakable } from './sentences'
import {
  browserSynth,
  browserUtterance,
  createSpeechQueue,
  type SpeechQueue,
  type SynthLike,
  type UtteranceLike,
} from './speechQueue'

export interface ReplyVoice {
  /** A piece of streamed answer text. */
  push: (delta: string) => void
  /** One piece of the answer is complete (the model went off to call a tool): speak what is left of it now. */
  segmentEnd: () => void
  /** The server has sent the whole answer. */
  finish: () => void
  /** Stop: drops the rest of the speech now. */
  cancel: () => void
}

// A tail that ends like a sentence is spoken after the stream has been quiet this long.
const SETTLE_MS = 250

interface Deps {
  synth: SynthLike | null
  makeUtterance: (text: string) => UtteranceLike
  now: () => number
}

const BROWSER: () => Deps = () => ({ synth: browserSynth(), makeUtterance: browserUtterance, now: () => performance.now() })

export function createReplyVoice(emit: (action: RunAction) => void, deps: Deps = BROWSER()): ReplyVoice {
  const { synth, makeUtterance, now } = deps
  const splitter = createSentenceSplitter()
  let queue: SpeechQueue | null = null
  let cancelled = false
  let noVoiceSent = false

  // The queue is indexed by what it was given, but the screen indexes by sentence. A sentence with
  // nothing to say (only markdown marks) is given no turn, so the two lists are kept in step here.
  const turnOf: number[] = []
  let sentenceCount = 0

  const noVoice = () => {
    if (noVoiceSent) return
    noVoiceSent = true
    emit({ type: 'no-voice', now: now() })
  }

  if (synth) {
    queue = createSpeechQueue(synth, makeUtterance, {
      onStart: index => emit({ type: 'speech-start', index: turnOf[index] ?? index, now: now() }),
      onEnd: index => emit({ type: 'speech-end', index: turnOf[index] ?? index }),
      onIdle: () => emit({ type: 'voice-idle', now: now() }),
      onNoVoice: noVoice,
      onFailure: message => emit({ type: 'voice-failed', message, now: now() }),
    })
  }

  const hand = (sentences: string[]) => {
    for (const sentence of sentences) {
      const words = speakable(sentence)
      if (queue && words) turnOf[queue.enqueue(words)] = sentenceCount
      sentenceCount += 1
    }
  }

  let settleTimer: ReturnType<typeof setTimeout> | undefined
  const release = (sentences: string[]) => {
    clearTimeout(settleTimer)
    emit({ type: 'text', sentences, rest: splitter.pending(), now: now() })
    if (!queue) noVoice()
    hand(sentences)
  }

  return {
    push(delta) {
      if (cancelled) return
      release(splitter.push(delta))
      clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        const settled = splitter.settle()
        if (!cancelled && settled.length > 0) release(settled)
      }, SETTLE_MS)
    },
    segmentEnd() {
      if (!cancelled) release(splitter.flush())
    },
    finish() {
      if (cancelled) return
      release(splitter.flush())
      queue?.finish()
    },
    cancel() {
      cancelled = true
      clearTimeout(settleTimer)
      queue?.cancel()
    },
  }
}
