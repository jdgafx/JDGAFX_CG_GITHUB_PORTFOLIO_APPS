import { useEffect, useRef, useState } from 'react'
import { installReplayShim, loadRecording, playbackSpeed, type Recording, type ReplayShim } from '../replay'
import type { CommonsImage } from './commons'
import { readCredit } from './credit'
import { isRecord } from './guards'
import { ACCEPTED_TYPES, fileProblem } from './image'

// The stored run of the built-in example, written daily by .github/workflows/replay-record.yml. Only that job can write it.
export const REPLAY_URL = 'https://raw.githubusercontent.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/replays/app-08-vision-ai.json'

// ?replay=off loads the page as it was before replays existed. The recorder uses it so it always records a live run.
export function replayDisabled(search: string): boolean {
  return new URLSearchParams(search).get('replay') === 'off'
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

export interface RecordedPicture {
  file: File
  /** The Commons credit the page sent with the picture, when the recording has one. */
  credit: CommonsImage | null
}

function firstAnalysis(recording: Recording): Record<string, unknown> | null {
  const first = recording.exchanges.find(e => e.method === 'POST' && e.path === '/api/ai')
  if (!first?.request_body) return null
  try {
    const body: unknown = JSON.parse(first.request_body)
    return isRecord(body) ? body : null
  } catch {
    return null
  }
}

/**
 * The picture the recorded run described, rebuilt from the image in its first /api/ai request, with its credit.
 * Null when the recording has no whole-picture "Describe" request the page could send again: the page then shows today's empty state.
 */
export function recordedPicture(recording: Recording): RecordedPicture | null {
  const body = firstAnalysis(recording)
  if (!body || body.mode !== 'describe' || body.image2 !== undefined) return null
  const { image, mediaType } = body
  if (typeof image !== 'string' || !BASE64.test(image) || typeof mediaType !== 'string' || !ACCEPTED_TYPES.includes(mediaType)) return null
  let bytes: Uint8Array<ArrayBuffer>
  try {
    const binary = atob(image)
    bytes = new Uint8Array(new ArrayBuffer(binary.length))
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  } catch {
    return null
  }
  const credit = readCredit(body.credit)
  const extension = mediaType.split('/')[1] ?? 'jpg'
  const file = new File([bytes], credit?.fileName ?? `recorded-picture.${extension}`, { type: mediaType })
  return fileProblem(file) ? null : { file, credit }
}

/**
 * True when the request the page really made is the one that was recorded: the same picture, type, mode and question.
 * The credit rides along in the body but does not decide a match, and key order does not matter.
 */
export function sameRequest(recorded: string | null, actual: string | null): boolean {
  if (recorded === null || actual === null) return recorded === actual
  try {
    const a: unknown = JSON.parse(recorded)
    const b: unknown = JSON.parse(actual)
    if (!isRecord(a) || !isRecord(b)) return false
    return (['image', 'mediaType', 'mode', 'question', 'image2'] as const).every(key => a[key] === b[key])
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
  /** False once the visitor has done anything: a replay only ever starts from the empty screen. */
  idle: boolean
  /** Puts the recorded picture on the page and runs it through the page's own client. The shim is already in place, so its fetch is answered from the recording. */
  start: (picture: RecordedPicture) => void
  /** Takes the replayed run off the screen when the recording could not answer it. */
  clear: () => void
}

/**
 * On load, reads the stored recording and, if it is fresh and well formed, plays it back through the page's own client
 * (start) with fetch answered from the recording. Any problem (missing, stale, malformed, a visitor who got there first)
 * leaves today's empty state. A replay sends nothing: the shim answers every /api/ call.
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
    void loadRecording(REPLAY_URL, Date.now(), window.fetch.bind(window), controller.signal).then(result => {
      if (result.ok && !controller.signal.aborted) setRecording(result.recording)
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!recording || attempted.current) return
    // The recording arrived after the visitor had started something: it is never played over their work.
    attempted.current = true
    if (!idle) return
    const picture = recordedPicture(recording)
    if (!picture) return
    shim.current = installReplayShim(recording, {
      target: globalThis,
      origin: window.location.origin,
      speed: playbackSpeed(recording),
      requestMatches: sameRequest,
      onDiverge: () => {
        shim.current = null
        latest.current.clear()
      },
      onDone: () => {
        shim.current = null
      },
    })
    latest.current.start(picture)
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
