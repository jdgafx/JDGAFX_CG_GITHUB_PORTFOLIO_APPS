// Time to first audio: from the end of the visitor's speech (or the press of Ask for a typed
// question) to the moment the browser's voice starts the first sentence. The parts add up to it.
// All marks are performance.now() readings in milliseconds.

export interface Marks {
  /** End of speech for a voice question, submit for a typed one. */
  origin: number
  /** The transcript came back (voice only). */
  transcriptAt?: number
  /** The model asked for tools (its first call ended). */
  toolsStartAt?: number
  /** The last tool result arrived. */
  toolsEndAt?: number
  /** The first piece of answer text arrived. */
  firstTokenAt?: number
  /** The first sentence was complete and handed to the voice. */
  firstSentenceAt?: number
  /** The voice started the first sentence. */
  speechStartAt?: number
}

export interface Parts {
  transcribe?: number
  tools?: number
  firstToken?: number
  firstSentence?: number
  speechStart?: number
}

export interface Ttfa {
  parts: Parts
  /** Origin to the voice starting. Undefined until it has, or when this browser has no voice. */
  total?: number
  /** Origin to the first sentence being ready, which is the figure that still exists with no voice. */
  toFirstSentence?: number
}

const gap = (from: number | undefined, to: number | undefined): number | undefined =>
  from === undefined || to === undefined ? undefined : Math.max(0, Math.round(to - from))

export function ttfa(marks: Marks): Ttfa {
  const chatFrom = marks.transcriptAt ?? marks.origin
  // Tool lookups count only when they finished before the first word. When the model speaks first ("Let me
  // check") the lookups run while the voice is already talking, so they are not part of the wait.
  const beforeWords = marks.toolsStartAt !== undefined && marks.firstTokenAt !== undefined && marks.toolsStartAt < marks.firstTokenAt
  const toolsMs = beforeWords ? gap(marks.toolsStartAt, Math.min(marks.toolsEndAt ?? Infinity, marks.firstTokenAt ?? Infinity)) : undefined
  const untilToken = gap(chatFrom, marks.firstTokenAt)
  return {
    parts: {
      transcribe: gap(marks.origin, marks.transcriptAt),
      tools: toolsMs,
      // Time to the first word, less the tool lookups that sat inside it.
      firstToken: untilToken === undefined ? undefined : Math.max(0, untilToken - (toolsMs ?? 0)),
      firstSentence: gap(marks.firstTokenAt, marks.firstSentenceAt),
      speechStart: gap(marks.firstSentenceAt, marks.speechStartAt),
    },
    total: gap(marks.origin, marks.speechStartAt),
    toFirstSentence: gap(marks.origin, marks.firstSentenceAt),
  }
}
