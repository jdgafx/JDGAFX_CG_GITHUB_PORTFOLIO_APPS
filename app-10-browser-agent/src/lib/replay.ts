import type { ObservedPage, StepFrame } from '../types'
import type { Phase, RunState } from './runState'
import { stepLabel } from './shared'
import { planItems, type PlanStatus } from './trace'

/** Largest picture the page accepts, in JPEG bytes. It mirrors FRAME_MAX_BYTES on the server with a little room. */
export const CLIENT_FRAME_MAX_BYTES = 80_000
/** Largest total the page keeps for one run, in JPEG bytes. */
export const CLIENT_RUN_MAX_BYTES = 480_000
const UNREADABLE_FRAME = 'No picture: the page could not read the picture the server sent.'
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/** One step of the replay: the planned step, how it went, and the picture and text the browser held after it. */
export interface ReplayItem {
  index: number
  label: string
  thought: string
  status: PlanStatus
  detail: string
  frame?: StepFrame
  /** Why there is no picture, when the step ran and none came back. */
  note?: string
  observed?: ObservedPage
}

/**
 * Accepts a picture from the stream only when it is a small base64 JPEG with sane dimensions. Anything
 * else is dropped with a note, so a bad message can never put a broken image or a huge string on screen.
 */
export function cleanFrame(raw: unknown): { frame?: StepFrame; note?: string } {
  if (raw === undefined || raw === null) return {}
  const f = raw as Partial<StepFrame>
  const ok = typeof f.data === 'string'
    && BASE64.test(f.data)
    && typeof f.bytes === 'number' && f.bytes > 0 && f.bytes <= CLIENT_FRAME_MAX_BYTES
    && f.data.length <= Math.ceil(CLIENT_FRAME_MAX_BYTES / 3) * 4
    && typeof f.width === 'number' && f.width >= 1 && f.width <= 2000
    && typeof f.height === 'number' && f.height >= 1 && f.height <= 4000
  return ok ? { frame: { data: f.data!, width: f.width!, height: f.height!, bytes: f.bytes! } } : { note: UNREADABLE_FRAME }
}

/** Every planned step with its picture and observed text. A step the run never reached has neither. */
export function replayItems(state: RunState): ReplayItem[] {
  return planItems(state).map((item, index): ReplayItem => {
    const row = state.rows.find((candidate) => candidate.index === index)
    return {
      index,
      label: stepLabel(state.steps[index]),
      thought: item.thought,
      status: item.status,
      detail: row?.detail ?? (item.status === 'skipped' ? 'Not run.' : 'Waits for the steps before it.'),
      frame: row?.frame,
      note: row?.frameNote,
      observed: row?.observed,
    }
  })
}

/** Total picture bytes kept for a run, and how many steps have one. */
export function frameTotals(items: ReplayItem[]): { count: number; bytes: number } {
  const framed = items.filter((item) => item.frame)
  return { count: framed.length, bytes: framed.reduce((sum, item) => sum + (item.frame?.bytes ?? 0), 0) }
}

/** The step the viewer shows when the visitor has not chosen one: the live step while running, otherwise the failure, otherwise the last step that ran. */
export function followIndex(items: ReplayItem[], phase: Phase): number {
  if (items.length === 0) return 0
  const running = items.findIndex((item) => item.status === 'running')
  if (phase === 'running' && running >= 0) return running
  const failed = items.findIndex((item) => item.status === 'failed')
  if (failed >= 0) return failed
  let last = -1
  items.forEach((item, i) => {
    if (item.status === 'ok') last = i
  })
  return last >= 0 ? last : 0
}

/** Where an arrow key, Home or End moves the selection. Other keys return null. The ends do not wrap. */
export function moveIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null
  if (key === 'ArrowRight' || key === 'ArrowDown') return Math.min(current + 1, count - 1)
  if (key === 'ArrowLeft' || key === 'ArrowUp') return Math.max(current - 1, 0)
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/** The step after `current` that play moves to, or null at the last step that ran. Steps that never ran are not played. */
export function nextPlayable(items: ReplayItem[], current: number): number | null {
  for (let i = current + 1; i < items.length; i++) {
    if (items[i].status !== 'skipped' && items[i].status !== 'waiting') return i
  }
  return null
}

/** How many steps play can show, so the control can switch off when there is nothing to scrub. */
export function playableCount(items: ReplayItem[]): number {
  return items.filter((item) => item.status === 'ok' || item.status === 'failed').length
}
