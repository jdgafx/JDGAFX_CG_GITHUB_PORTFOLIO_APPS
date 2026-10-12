import { useEffect, useRef, useState } from 'react'
import { installReplayShim, loadRecording, type Recording, type ReplayShim } from '../replay'

// The stored run of the built-in example, written daily by .github/workflows/replay-record.yml. Only that job can write it.
export const REPLAY_URL = 'https://raw.githubusercontent.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/replays/app-03-ai-code-review.json'

// ?replay=off loads the page as it was before replays existed. The recorder uses it so it always records a live run.
export function replayDisabled(search: string): boolean {
  return new URLSearchParams(search).get('replay') === 'off'
}

/** True when the recording is of the very review Try it would start now: pass 1 was sent this exact text and language. */
export function recordsThisRun(recording: Recording, code: string, language: string): boolean {
  const first = recording.exchanges.find((e) => e.method === 'POST' && e.path === '/api/ai')
  return first !== undefined && first.request_body === JSON.stringify({ code, language })
}

interface ReplayDeps {
  /** Nothing is on the page yet: no run, no code, no Try it under way. A replay never starts over the visitor's own work. */
  idle: boolean
  /** Starts the example for this recording; the caller fetches the example and calls begin() before the review is sent. */
  onStart: (recording: Recording) => void
  /** The recording could not answer a call: the run was dropped and nothing of it was shown as real. */
  onDiverge: () => void
}

/**
 * On load, reads the stored recording. If it is fresh, the page hands it to onStart once; the example then runs through the
 * app's own client (reviewCode) with fetch answered from the recording. Any problem (missing, stale, malformed, a different
 * example, a visitor who got there first) leaves today's empty state. Nothing here ever sends a model request.
 */
export function useReplay({ idle, onStart, onDiverge }: ReplayDeps) {
  const [recording, setRecording] = useState<Recording | null>(null)
  // The label's age is counted from when the page loaded.
  const [loadedAt] = useState(() => Date.now())
  const shim = useRef<ReplayShim | null>(null)
  const attempted = useRef(false)
  const latest = useRef({ onStart, onDiverge })
  useEffect(() => {
    latest.current = { onStart, onDiverge }
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
    if (!recording || attempted.current) return
    attempted.current = true
    if (idle) latest.current.onStart(recording)
  }, [recording, idle])

  useEffect(() => () => shim.current?.stop(), [])

  /** Answers the review's /api calls from the recording, in real time. False (and nothing installed) unless it is a recording of this example. */
  function begin(code: string, language: string): boolean {
    if (!recording || !recordsThisRun(recording, code, language)) return false
    shim.current?.stop()
    shim.current = installReplayShim(recording, {
      target: globalThis,
      origin: window.location.origin,
      // Real time: the Time readout is measured by the page's clock, so a faster replay would show a time that never happened.
      speed: 1,
      onDiverge: () => {
        shim.current = null
        latest.current.onDiverge()
      },
      onDone: () => {
        shim.current = null
      },
    })
    return true
  }

  /** Ends a replay that is still playing: the page's own fetch is back before the caller sends anything. */
  function stop() {
    shim.current?.stop()
    shim.current = null
  }

  return { recording, loadedAt, begin, stop }
}
