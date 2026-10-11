import type { ModelCheck, ServedCall } from '../types'

export const count = (value: number): string => value.toLocaleString('en-US')
export const milliseconds = (ms: number): string => `${count(Math.round(ms))} ms`
export const usd = (cost: number): string => `$${cost.toFixed(5)}`
export const shortModel = (id: string): string => id.replace(/^anthropic\//, '')

export interface ServedChip {
  text: string
  /** One marker for the newest check, or null when there is nothing to add. */
  marker: string | null
  /** True when the marker is a warning. */
  warn: boolean
  /** The full served id, with the newest id added on a mismatch. */
  title: string | undefined
}

const MARKERS: Record<ModelCheck, string | null> = { match: '· newest', mismatch: '· not newest', unchecked: '· unchecked', 'not-reported': null }

/**
 * The served-model chip: the review pass's id as today, "not reported" when it named none, and one marker for the worst
 * check across the calls. The title lists each call's served id, and the newest id on a mismatch. Null when no model
 * call replied at all, so the cell shows a dash rather than implying a reply.
 */
export function servedChip(served: string | null, newest: string | null, check: ModelCheck, calls: ServedCall[]): ServedChip | null {
  if (served === null && calls.length === 0) return null
  const text = served === null ? 'not reported' : shortModel(served)
  const listed = calls.map((call) => `${call.pass}: ${call.model ?? 'not reported'}`)
  if (check === 'mismatch') listed.push(`newest: ${newest}`)
  return { text, marker: MARKERS[check], warn: check === 'mismatch', title: listed.length > 0 ? listed.join(', ') : undefined }
}
