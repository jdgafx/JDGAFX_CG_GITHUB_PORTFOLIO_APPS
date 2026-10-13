import { useEffect, useRef, useState } from 'react'
import type { ContentType } from '../../netlify/shared/contract'
import { installReplayShim, loadRecording, playbackSpeed, type Recording, type ReplayShim } from '../replay'

// The stored run of the built-in example, written daily by .github/workflows/replay-record.yml. Only that job can write it.
export const REPLAY_URL = 'https://raw.githubusercontent.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/replays/app-07-content-pipeline.json'

// ?replay=off loads the page as it was before replays existed. The recorder uses it so it always records a live run.
export function replayDisabled(search: string): boolean {
  return new URLSearchParams(search).get('replay') === 'off'
}

/** True when the recording is of the very brief Try it would start now: its first request names the same topic and format. */
export function recordsThisBrief(recording: Recording, topic: string, contentType: ContentType): boolean {
  const first = recording.exchanges.find(e => e.method === 'POST' && e.path === '/api/ai?stage=sources')
  if (!first?.request_body) return false
  try {
    const body = JSON.parse(first.request_body) as { topic?: unknown; contentType?: unknown }
    return body.topic === topic && body.contentType === contentType
  } catch {
    return false
  }
}

export interface ReplayInfo {
  recording: Recording
  speed: number
  startedAt: number
}

interface ReplayDeps {
  /** The brief Try it uses. A replay starts only when the recording is of this exact brief. */
  topic: string
  contentType: ContentType
  /** False once anything else has started (a run, a stop, a failure): a replay only ever starts from the empty screen. */
  idle: boolean
  /** Starts the page's own run, marked as a replay. The shim is already in place, so its fetch is answered from the recording. */
  start: () => Promise<void>
  /** Takes the replayed run off the screen when the recording could not answer it. */
  clear: () => void
}

/**
 * On load, reads the stored recording and, if it is fresh and is of the example brief on screen, plays it back through
 * the page's own client (start) with fetch answered from the recording. Any problem (missing, stale, malformed, another
 * brief, a visitor who got there first) leaves today's empty state. A replay sends nothing to the server.
 */
export function useReplay({ topic, contentType, idle, start, clear }: ReplayDeps) {
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
    if (!recording || attempted.current || !idle) return
    attempted.current = true
    if (!recordsThisBrief(recording, topic, contentType)) return
    shim.current = installReplayShim(recording, {
      target: globalThis,
      origin: window.location.origin,
      speed: playbackSpeed(recording),
      onDiverge: () => {
        shim.current = null
        latest.current.clear()
      },
      onDone: () => {
        shim.current = null
      },
    })
    void latest.current.start()
  }, [recording, topic, contentType, idle])

  useEffect(() => () => shim.current?.stop(), [])

  /** Ends a replay that is still playing: the page's own fetch is back before the caller sends anything. */
  function stop(): void {
    shim.current?.stop()
    shim.current = null
  }

  /** What the label needs, for the caller to show while its own run is the replayed one. */
  const info: ReplayInfo | null = recording ? { recording, speed: playbackSpeed(recording), startedAt: loadedAt } : null
  return { info, stop }
}
