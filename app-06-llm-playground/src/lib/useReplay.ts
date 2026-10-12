import { useEffect, useRef, useState } from 'react'
import type { CatalogueResponse } from '../../netlify/shared/contract'
import { installReplayShim, loadRecording, playbackSpeed, type Recording, type ReplayShim } from '../replay'
import { compareRequest, type RunInput } from './useArena'
import type { RunView } from './run'

// The stored run of the built-in example, written daily by .github/workflows/replay-record.yml. Only that job can write it.
export const REPLAY_URL = 'https://raw.githubusercontent.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/replays/app-06-llm-playground.json'

// ?replay=off loads the page as it was before replays existed. The recorder uses it so it always records a live run.
export function replayDisabled(search: string): boolean {
  return new URLSearchParams(search).get('replay') === 'off'
}

// The live request is the recorded one when everything but the first model matches: the server ignores models[0]
// (Panel A always runs the fixed default), so a changed default does not make a recording wrong.
export function requestMatches(recorded: string | null, actual: string | null, path: string): boolean {
  if (recorded === null || actual === null) return recorded === actual
  if (!path.startsWith('/api/compare')) return recorded === actual
  try {
    const a = JSON.parse(recorded) as { models?: unknown[] }
    const b = JSON.parse(actual) as { models?: unknown[] }
    if (!Array.isArray(a.models) || !Array.isArray(b.models)) return false
    return JSON.stringify({ ...a, models: a.models.slice(1) }) === JSON.stringify({ ...b, models: b.models.slice(1) })
  } catch {
    return false
  }
}

// True when the recording is of the very run Try it would start now: same request, so the screen and the recording agree.
export function recordsThisRun(recording: Recording, catalogue: CatalogueResponse, input: RunInput): boolean {
  const compare = recording.exchanges.find(e => e.method === 'POST' && e.path === '/api/compare')
  if (!compare) return false
  return requestMatches(compare.request_body, JSON.stringify(compareRequest(catalogue.defaultModel, input)), '/api/compare')
}

export interface ReplayInfo {
  recording: Recording
  speed: number
  startedAt: number
}

interface ReplayDeps {
  catalogue: CatalogueResponse | null
  run: RunView | null
  /** The input Try it uses. A replay starts only when the recording is of this exact run. */
  input: RunInput
  start: (input: RunInput, options: { replay: true }) => Promise<void>
  clear: () => void
}

/**
 * On load, reads the stored recording and, if it is fresh and is a recording of this app's example as it is now,
 * plays it back through the app's own client (arena.start) with fetch answered from the recording. Any problem
 * (missing, stale, malformed, a different request, a visitor who got there first) leaves today's empty state.
 */
export function useReplay({ catalogue, run, input, start, clear }: ReplayDeps) {
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
    if (!recording || !catalogue || attempted.current || run !== null) return
    attempted.current = true
    if (!recordsThisRun(recording, catalogue, input)) return
    const speed = playbackSpeed(recording)
    shim.current = installReplayShim(recording, {
      target: globalThis,
      origin: window.location.origin,
      speed,
      requestMatches,
      onDiverge: () => {
        shim.current = null
        latest.current.clear()
      },
      onDone: () => {
        shim.current = null
      },
    })
    void latest.current.start(input, { replay: true })
  }, [recording, catalogue, run, input])

  useEffect(() => () => shim.current?.stop(), [])

  // Ends a replay that is still playing: the page's own fetch is back before the caller sends anything.
  function stop() {
    shim.current?.stop()
    shim.current = null
  }

  const info: ReplayInfo | null = recording && run?.replay ? { recording, speed: playbackSpeed(recording), startedAt: loadedAt } : null
  return { info, stop }
}
