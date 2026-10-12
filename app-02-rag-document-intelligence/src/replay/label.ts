// What the replay label says. Every figure comes from the recording; nothing here is a constant about a run.

import { spanMs, type Recording } from './recording'

// A replay of a long run is sped up so it finishes in about this long; the label says so when it is.
export const TARGET_REPLAY_MS = 15_000

/** 1 when the real run was short enough (about 15 s or less) to replay in real time, otherwise the factor that fits it into about 15 s. */
export function playbackSpeed(recording: Recording, targetMs: number = TARGET_REPLAY_MS): number {
  const factor = spanMs(recording) / targetMs
  return factor > 1 ? Math.round(factor * 10) / 10 : 1
}

export function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.floor(hours / 24)} days ago`
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(6)}`
}

export interface ReplayLabel {
  /** "2 h ago" */
  age: string
  /** "judged by <model>" */
  model: string
  /** "judge call $0.000412" */
  cost: string
  /** set only when the replay is faster than the real run, e.g. "Shown at 2.3x speed; the real run took 23.4 s." */
  speedNote: string | null
}

export function replayLabel(recording: Recording, now: number, speed: number): ReplayLabel {
  const { model, model_role: role, cost_usd: cost, cost_scope: scope } = recording.reported
  return {
    age: formatAge(now - Date.parse(recording.recorded_at)),
    model: `${role === 'judge' ? 'judged by' : role} ${model}`,
    cost: `${scope} ${formatUsd(cost)}`,
    speedNote: speed > 1 ? `Shown at ${speed}x speed; the real run took ${(spanMs(recording) / 1000).toFixed(1)} s.` : null,
  }
}
