import { useEffect, useRef, useState } from 'react'
import { installReplayShim, loadRecording, playbackSpeed, type Recording, type ReplayShim } from '../replay'
import { AUTHOR_ASSOCIATIONS, type IssueInput } from '../types'

// The stored run of the built-in example, written daily by .github/workflows/replay-record.yml. Only that job can write it.
export const REPLAY_URL = 'https://raw.githubusercontent.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/replays/app-12-langgraph-approval-flow.json'

// ?replay=off loads the page as it was before replays existed. The recorder uses it so it always records a live run.
export function replayDisabled(search: string): boolean {
  return new URLSearchParams(search).get('replay') === 'off'
}

function isIssue(value: unknown): value is IssueInput {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.repo === 'string' &&
    /^[\w.-]+\/[\w.-]+$/.test(v.repo) &&
    typeof v.number === 'number' &&
    Number.isInteger(v.number) &&
    v.number > 0 &&
    typeof v.title === 'string' &&
    typeof v.body === 'string' &&
    Array.isArray(v.labels) &&
    v.labels.every((label) => typeof label === 'string') &&
    typeof v.authorAssociation === 'string' &&
    (AUTHOR_ASSOCIATIONS as readonly string[]).includes(v.authorAssociation) &&
    typeof v.createdAt === 'string' &&
    typeof v.htmlUrl === 'string' &&
    v.htmlUrl === `https://github.com/${v.repo}/issues/${v.number}` &&
    typeof v.comments === 'number'
  )
}

/** The issue the recorded run triaged: the issue in its first /api/start request. Null when the recording has no readable one. */
export function recordedIssue(recording: Recording): IssueInput | null {
  const first = recording.exchanges.find((e) => e.method === 'POST' && e.path === '/api/start')
  if (!first?.request_body) return null
  try {
    const body = JSON.parse(first.request_body) as { issue?: unknown }
    return isIssue(body.issue) ? body.issue : null
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
  /** False once anything else has started (a run, a stop, a failure): a replay only ever starts from the empty screen. */
  idle: boolean
  /** Starts the page's own triage of this issue, marked as a replay. The shim is already in place, so its fetch is answered from the recording. */
  start: (issue: IssueInput) => void
  /** Takes the replayed run off the screen when the recording could not answer it. */
  clear: () => void
}

/**
 * On load, reads the stored recording and, if it is fresh and well formed, plays it back through the page's own client
 * (start) with fetch answered from the recording. Any problem (missing, stale, malformed, a visitor who got there first)
 * leaves today's empty state. A replay sends nothing: the shim answers every /api/ call, and the approval is never sent.
 */
export function useReplay({ idle, start, clear }: ReplayDeps) {
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
    if (!recording || attempted.current || !idle) return
    attempted.current = true
    const issue = recordedIssue(recording)
    if (!issue) return
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
    latest.current.start(issue)
  }, [recording, idle])

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
