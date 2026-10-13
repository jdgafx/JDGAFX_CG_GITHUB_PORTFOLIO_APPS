import { useEffect, useRef, useState } from 'react'
import type { Day } from '../../shared/types'
import { installReplayShim, loadRecording, playbackSpeed, type Recording, type ReplayShim } from '../replay'
import { TRY_IT } from './useRun'

// The stored run of the built-in example, written daily by .github/workflows/replay-record.yml. Only that job can write it.
export const REPLAY_URL = 'https://raw.githubusercontent.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/replays/app-09-ai-saas.json'

// ?replay=off loads the page as it was before replays existed. The recorder uses it so it always records a live run.
export function replayDisabled(search: string): boolean {
  return new URLSearchParams(search).get('replay') === 'off'
}

interface RecordedAsk {
  target: string
  names: string[]
  days: number
  runDate: string
}

function parseAsk(body: string | null): RecordedAsk | null {
  if (body === null) return null
  try {
    const req = JSON.parse(body) as { target?: unknown; names?: unknown; window?: { days?: unknown; runDate?: unknown } }
    const { target, names, window } = req
    if (typeof target !== 'string' || !Array.isArray(names) || !names.every(n => typeof n === 'string')) return null
    if (typeof window?.days !== 'number' || typeof window.runDate !== 'string') return null
    return { target, names: names as string[], days: window.days, runDate: window.runDate }
  } catch {
    return null
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * The live request is the recorded one when it asks for the same package, among the same packages, over the same window
 * and day. The figures inside it come from npm and may differ by a revised count, so they are not compared: the answer is
 * judged against the figures npm gives now.
 */
export function requestMatches(recorded: string | null, actual: string | null, path: string): boolean {
  if (!path.startsWith('/api/explain')) return recorded === actual
  const a = parseAsk(recorded)
  const b = parseAsk(actual)
  return a !== null && b !== null && a.target === b.target && a.days === b.days && a.runDate === b.runDate && JSON.stringify(a.names) === JSON.stringify(b.names)
}

/**
 * The day the recorded run was made for, when the recording is of the very comparison Try it starts (same packages in the
 * same order, same window, one run day). Null for anything else, and the page then shows today's live view and no replay.
 */
export function recordedRunDate(recording: Recording): Day | null {
  const asks = recording.exchanges.filter(e => e.method === 'POST' && e.path === '/api/explain').map(e => parseAsk(e.request_body))
  if (asks.length !== TRY_IT.names.length || asks.some(a => a === null)) return null
  const list = asks as RecordedAsk[]
  const first = list[0]!
  if (!list.every((a, i) => a.target === TRY_IT.names[i] && a.days === TRY_IT.days && a.runDate === first.runDate)) return null
  return DAY.test(first.runDate) ? first.runDate : null
}

/** What the recorded explanation calls cost, counted as the readout counts a live run: calls that reported none are counted, not hidden. */
export function recordedCost(recording: Recording): { cost: number | null; unreported: number } {
  let cost = 0
  let reported = 0
  let unreported = 0
  for (const e of recording.exchanges) {
    if (e.method !== 'POST' || e.path !== '/api/explain') continue
    let usd: unknown
    try {
      usd = (JSON.parse(e.chunks.map(c => c.text).join('')) as { costUsd?: unknown }).costUsd
    } catch {
      usd = undefined
    }
    if (typeof usd === 'number' && Number.isFinite(usd) && usd >= 0) {
      cost += usd
      reported += 1
    } else unreported += 1
  }
  return { cost: reported > 0 ? cost : null, unreported }
}

export interface ReplayInfo {
  recording: Recording
  speed: number
  startedAt: number
}

interface ReplayDeps {
  /** Nothing has run, the comparison on screen is the Try it one and its downloads have arrived: the screen a replay may start from. */
  ready: boolean
  /** Starts the page's own Try it for the recorded day. The shim is already in place, so its requests are answered from the recording. */
  start: (runDate: Day) => void
  /** The recording could not answer a call: the caller takes the replayed run off the screen. */
  clear: () => void
}

/**
 * On load, reads the stored recording and, if it is fresh and is of the comparison on screen, plays it back through the
 * page's own client (start) with /api/* answered from the recording. Downloads still come from npm, for the recorded day.
 * Any problem (missing, stale, malformed, another comparison, a visitor who got there first) leaves today's live view.
 * A replay sends nothing to the server.
 */
export function useReplay({ ready, start, clear }: ReplayDeps) {
  const [recording, setRecording] = useState<Recording | null>(null)
  // The label's age is counted from when the page loaded.
  const [loadedAt] = useState(() => Date.now())
  const shim = useRef<ReplayShim | null>(null)
  const attempted = useRef(false)
  const latest = useRef({ start, clear })
  useEffect(() => {
    latest.current = { start, clear }
  })

  useEffect(() => {
    if (replayDisabled(window.location.search)) return
    const controller = new AbortController()
    void loadRecording(REPLAY_URL, Date.now(), window.fetch.bind(window), controller.signal).then(result => {
      if (result.ok && !controller.signal.aborted) setRecording(result.recording)
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!recording || attempted.current || !ready) return
    attempted.current = true
    const runDate = recordedRunDate(recording)
    if (runDate === null) return
    shim.current = installReplayShim(recording, {
      target: globalThis,
      origin: window.location.origin,
      speed: playbackSpeed(recording),
      requestMatches,
      onDiverge: () => {
        shim.current = null
        latest.current.clear()
      },
      onDone: () => {
        shim.current = null
      },
    })
    latest.current.start(runDate)
  }, [recording, ready])

  useEffect(() => () => shim.current?.stop(), [])

  /** Ends a replay that is still playing and forbids a late one: the page's own fetch is back before the caller sends anything. */
  function stop() {
    attempted.current = true
    shim.current?.stop()
    shim.current = null
  }

  const info: ReplayInfo | null = recording ? { recording, speed: playbackSpeed(recording), startedAt: loadedAt } : null
  return { info, stop }
}
