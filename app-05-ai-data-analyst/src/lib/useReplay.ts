import { useEffect, useRef, useState } from 'react'
import { installReplayShim, loadRecording, playbackSpeed, type Recording, type ReplayShim } from '../replay'
import { TRY_QUESTION } from './howto'

// The stored run of the built-in example, written daily by .github/workflows/replay-record.yml. Only that job can write it.
export const REPLAY_URL = 'https://raw.githubusercontent.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/replays/app-05-ai-data-analyst.json'

// ?replay=off loads the page as it was before replays existed. The recorder uses it so it always records a live run.
export function replayDisabled(search: string): boolean {
  return new URLSearchParams(search).get('replay') === 'off'
}

/**
 * The live request is the recorded one when the question and the columns are the same. The sample rows and the row count
 * are left out on purpose: the USGS week feed moves every minute, so they never repeat, and the plan the model wrote for
 * these columns is drawn over the rows the browser fetched just now. A follow-up (a request with a previous plan) never matches.
 */
export function requestMatches(recorded: string | null, actual: string | null): boolean {
  if (recorded === null || actual === null) return recorded === actual
  try {
    const a = JSON.parse(recorded) as { question?: unknown; headers?: unknown; previous?: unknown }
    const b = JSON.parse(actual) as { question?: unknown; headers?: unknown; previous?: unknown }
    return a.question === b.question && a.previous === undefined && b.previous === undefined && JSON.stringify(a.headers) === JSON.stringify(b.headers)
  } catch {
    return false
  }
}

/** True when the recording is of the very run Try it would start now: the example question about these columns. */
export function recordsThisRun(recording: Recording, headers: string[]): boolean {
  const ask = recording.exchanges.find((e) => e.method === 'POST' && e.path === '/api/ai')
  return ask !== undefined && requestMatches(ask.request_body, JSON.stringify({ question: TRY_QUESTION, headers }))
}

export interface ReplayInfo {
  recording: Recording
  speed: number
  startedAt: number
}

interface ReplayDeps {
  /** The week's earthquake columns once the feed has loaded, or null while it has not (or another dataset is chosen). */
  headers: string[] | null
  /** False once anything else has started (a typed question, a run, Try it): a replay only ever starts from the empty screen. */
  idle: boolean
  /** Starts the page's own run of the example, marked as a replay. The shim is already in place. Resolves true when it drew a result. */
  start: () => Promise<boolean>
  /** Takes a replay that could not be answered from its recording off the screen. */
  clear: () => void
}

/**
 * On load, reads the stored recording and, if it is fresh and is of the example question about the columns on screen,
 * plays it back through the page's own client (start) with fetch answered from the recording. Any problem (missing, stale,
 * malformed, another question, a visitor who got there first) leaves today's empty state. A replay sends nothing.
 */
export function useReplay({ headers, idle, start, clear }: ReplayDeps) {
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
    void loadRecording(REPLAY_URL, Date.now(), window.fetch.bind(window), controller.signal).then((result) => {
      if (result.ok && !controller.signal.aborted) setRecording(result.recording)
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!recording || !headers || attempted.current) return
    // The first moment both are ready is the only chance: a visitor who got there first keeps the empty screen.
    attempted.current = true
    if (!idle || !recordsThisRun(recording, headers)) return
    shim.current = installReplayShim(recording, {
      target: globalThis,
      origin: window.location.origin,
      speed: playbackSpeed(recording),
      requestMatches,
      onDiverge: () => {
        shim.current = null
      },
      onDone: () => {
        shim.current = null
      },
    })
    void latest.current.start().then((drawn) => {
      if (drawn) return
      // The recording could not answer, or the plan did not fit the rows: nothing is shown as real.
      shim.current?.stop()
      shim.current = null
      latest.current.clear()
    })
  }, [recording, headers, idle])

  useEffect(() => () => shim.current?.stop(), [])

  /** Ends a replay that is still playing: the page's own fetch is back before the caller sends anything. */
  function stop(): void {
    shim.current?.stop()
    shim.current = null
  }

  const info: ReplayInfo | null = recording ? { recording, speed: playbackSpeed(recording), startedAt: loadedAt } : null
  return { info, stop }
}
