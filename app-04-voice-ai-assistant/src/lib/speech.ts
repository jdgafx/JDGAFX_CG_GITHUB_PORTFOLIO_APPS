// Browser speech synthesis with a watchdog.
//
// speechSynthesis is unreliable: `onend` can silently never fire (tab
// backgrounded, engine hiccup, Chrome's ~15s utterance cut-off), which used to
// strand the UI in the 'speaking' state forever. Every path here ends in
// exactly one terminal callback.

// Rough upper bound on speaking time: a slow reader manages ~11 chars/second.
const MS_PER_CHAR = 90
const BASE_GRACE_MS = 5_000
const MAX_WATCHDOG_MS = 180_000

// If word boundaries stop arriving for this long while we still believe speech
// is in flight, treat the utterance as finished.
const BOUNDARY_GRACE_MS = 12_000

// Chrome pauses long utterances when the tab loses focus; a periodic resume
// keeps playback alive.
const KEEPALIVE_MS = 8_000

export interface SpeakOptions {
  onEnd: () => void
  onError: (message: string) => void
}

export interface SpeakHandle {
  cancel: () => void
}

// Some platforms expose speechSynthesis but ship no voices at all (a Linux
// desktop without speech-dispatcher, most headless browsers). There, every
// utterance fails — so after the first failure on a voiceless platform we stop
// trying and stop nagging, instead of putting a red banner on every reply.
let speechUnavailable = false

export function isSpeechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && !speechUnavailable
}

function hasVoices(): boolean {
  try {
    return window.speechSynthesis.getVoices().length > 0
  } catch {
    return false
  }
}

export function cancelSpeech(): void {
  if (!isSpeechAvailable()) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    // Synthesis is already torn down; nothing to cancel.
  }
}

export function speak(text: string, { onEnd, onError }: SpeakOptions): SpeakHandle {
  if (!isSpeechAvailable() || typeof SpeechSynthesisUtterance === 'undefined') {
    // No voice support in this browser — the response is still shown in chat.
    onEnd()
    return { cancel: () => {} }
  }

  let settled = false
  let watchdog: number | undefined
  let keepalive: number | undefined

  const clearTimers = () => {
    if (watchdog !== undefined) window.clearTimeout(watchdog)
    if (keepalive !== undefined) window.clearInterval(keepalive)
    watchdog = undefined
    keepalive = undefined
  }

  const settle = (fail?: string) => {
    if (settled) return
    settled = true
    clearTimers()
    cancelSpeech()
    if (fail) onError(fail)
    else onEnd()
  }

  const armWatchdog = (ms: number) => {
    if (watchdog !== undefined) window.clearTimeout(watchdog)
    watchdog = window.setTimeout(() => settle(), ms)
  }

  try {
    // Anything still queued would otherwise play before this response.
    cancelSpeech()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.0
    utterance.pitch = 1.0
    utterance.onend = () => settle()
    utterance.onerror = event => {
      // Cancelling on purpose surfaces as an error event; that is not a failure.
      if (event.error === 'canceled' || event.error === 'interrupted') {
        settle()
      } else if (!hasVoices()) {
        // Nothing installed to speak with — degrade quietly to text-only.
        speechUnavailable = true
        settle()
      } else {
        settle('Voice playback failed. The response is shown in chat.')
      }
    }
    utterance.onboundary = () => armWatchdog(BOUNDARY_GRACE_MS)

    armWatchdog(Math.min(BASE_GRACE_MS + text.length * MS_PER_CHAR, MAX_WATCHDOG_MS))
    keepalive = window.setInterval(() => {
      try {
        window.speechSynthesis.resume()
      } catch {
        // Ignore — the watchdog still guarantees a terminal state.
      }
    }, KEEPALIVE_MS)

    window.speechSynthesis.speak(utterance)
  } catch (err) {
    console.error('speech: synthesis failed to start', err)
    settle('Voice playback is unavailable. The response is shown in chat.')
  }

  return { cancel: () => settle() }
}
