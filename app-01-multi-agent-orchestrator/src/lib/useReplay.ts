import { useEffect, useRef, useState } from 'react'
import { installReplayShim, loadRecording, playbackSpeed, type Recording, type ReplayShim } from '../replay'

// The stored run of the built-in example, written daily by .github/workflows/replay-record.yml. Only that job can write it.
export const REPLAY_URL = 'https://raw.githubusercontent.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/replays/app-01-multi-agent-orchestrator.json'

// ?replay=off loads the page as it was before replays existed. The recorder uses it so it always records a live run.
export function replayDisabled(search: string): boolean {
  return new URLSearchParams(search).get('replay') === 'off'
}

/** The question the recorded run researched: the query in its first request. Null when the recording has no such request. */
export function recordedQuery(recording: Recording): string | null {
  const first = recording.exchanges.find(e => e.method === 'POST' && e.path === '/api/ai')
  if (!first?.request_body) return null
  try {
    const body = JSON.parse(first.request_body) as { query?: unknown }
    return typeof body.query === 'string' ? body.query : null
  } catch {
    return null
  }
}

export interface ReplayInfo {
  recording: Recording
  speed: number
  startedAt: number
}

interface ReplayDeps {
  /** The question Try it asks now. A recording of any other question is never played. */
  question: string
  /** True while the page is still empty: nothing typed, nothing running, nothing on screen. A visitor who got there first wins. */
  canStart: () => boolean
  /** Fills the topic and starts the page's own run, marked as a replay. The shim is already in place, so its fetch is answered from the recording. */
  begin: (question: string) => void
  /** Puts the page back to its empty state after a replay that could not finish. */
  clear: () => void
}

/**
 * On load, reads the stored recording and, if it is fresh and is of the question Try it asks, plays it back through the
 * page's own client (begin) with /api/ai and /api/audit answered from the recording. Any problem (missing, stale,
 * malformed, another question, a visitor who got there first) leaves today's empty state. A replay sends nothing.
 */
export function useReplay({ question, canStart, begin, clear }: ReplayDeps) {
  const [info, setInfo] = useState<ReplayInfo | null>(null)
  // The label's age is counted from when the page loaded.
  const [loadedAt] = useState(() => Date.now())
  const shim = useRef<ReplayShim | null>(null)
  const latest = useRef({ canStart, begin, clear })
  useEffect(() => {
    latest.current = { canStart, begin, clear }
  })

  useEffect(() => {
    if (replayDisabled(window.location.search)) return
    const controller = new AbortController()
    void loadRecording(REPLAY_URL, Date.now(), window.fetch.bind(window), controller.signal).then(result => {
      if (!result.ok || controller.signal.aborted || recordedQuery(result.recording) !== question || !latest.current.canStart()) return
      const recording = result.recording
      const speed = playbackSpeed(recording)
      shim.current = installReplayShim(recording, {
        target: globalThis,
        origin: window.location.origin,
        speed,
        onDiverge: () => {
          shim.current = null
          setInfo(null)
          latest.current.clear()
        },
        onDone: () => {
          shim.current = null
        },
      })
      setInfo({ recording, speed, startedAt: loadedAt })
      latest.current.begin(question)
    })
    return () => controller.abort()
  }, [question, loadedAt])

  useEffect(() => () => shim.current?.stop(), [])

  /** Ends a replay that is still playing and drops its label: the page's own fetch is back before the caller sends anything. */
  function stop(): void {
    shim.current?.stop()
    shim.current = null
    setInfo(null)
  }

  return { info, stop }
}
