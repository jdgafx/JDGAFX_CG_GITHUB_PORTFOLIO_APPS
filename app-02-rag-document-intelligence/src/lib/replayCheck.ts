import type { Recording } from '../replay/recording'
import { retrieve } from './bm25'
import { askBody } from './api'
import { TRY_QUESTION } from './howto'
import type { DocumentState } from '../types'

// ?replay=off loads the page as it was before replays existed. The recorder uses it so it always records a live run.
export function replayDisabled(search: string): boolean {
  return new URLSearchParams(search).get('replay') === 'off'
}

/** The recorded request for the example, or null when the recording has none. */
export function recordedAsk(recording: Recording): string | null {
  const ask = recording.exchanges.find(e => e.method === 'POST' && e.path === '/api/ai')
  return ask?.request_body ?? null
}

/**
 * True when the recording is of the very question Try it would send for this article now: same passages, same
 * wording. Its citations then point at the passages on screen. Wikipedia edits that change the passages make this false.
 */
export function recordsThisAsk(recording: Recording, doc: DocumentState): boolean {
  const recorded = recordedAsk(recording)
  if (recorded === null) return false
  return recorded === askBody(TRY_QUESTION, doc.chunks, doc.title, retrieve(TRY_QUESTION, doc.chunks).ranked)
}
