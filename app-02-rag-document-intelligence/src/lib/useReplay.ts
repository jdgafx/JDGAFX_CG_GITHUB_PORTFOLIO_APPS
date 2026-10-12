import { useEffect, useRef, useState } from 'react'
import { installReplayShim, loadRecording, playbackSpeed, type Recording, type ReplayShim } from '../replay'
import { TRY_ARTICLE } from './howto'
import { loadSource } from './loadSource'
import { recordedAsk, recordsThisAsk, replayDisabled } from './replayCheck'
import type { DocumentState } from '../types'

// The stored run of the built-in example, written daily by .github/workflows/replay-record.yml. Only that job can write it.
export const REPLAY_URL = 'https://raw.githubusercontent.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/replays/app-02-rag-document-intelligence.json'

export interface ReplayInfo {
  recording: Recording
  speed: number
  startedAt: number
}

interface ReplayDeps {
  /** True while the page is still empty: no document, nothing loading, nothing running. A visitor who got there first wins. */
  canStart: () => boolean
  /** Shows the article and asks the example question about it, with fetch already answered from the recording. */
  begin: (doc: DocumentState) => void
  /** Puts the page back to its empty state after a replay that could not finish. */
  clear: () => void
}

/**
 * On load, reads the stored recording and, if it is fresh, fetches the example article (a free Wikipedia read, no model)
 * and checks the recording is of the question Try it would ask about it now. Then it plays the recording back through the
 * app's own client (begin) with /api/ai answered from the recording. Any problem (missing, stale, malformed, a different
 * article text, a visitor who got there first) leaves today's empty state, and no model request is made.
 */
export function useReplay({ canStart, begin, clear }: ReplayDeps) {
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
    void (async () => {
      const result = await loadRecording(REPLAY_URL, Date.now(), window.fetch.bind(window), controller.signal)
      if (!result.ok || controller.signal.aborted || recordedAsk(result.recording) === null) return
      const recording = result.recording
      let doc: DocumentState
      try {
        doc = await loadSource({ kind: 'wikipedia', title: TRY_ARTICLE }, controller.signal)
      } catch {
        return
      }
      if (controller.signal.aborted || !latest.current.canStart() || !recordsThisAsk(recording, doc)) return
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
      latest.current.begin(doc)
    })()
    return () => controller.abort()
  }, [loadedAt])

  useEffect(() => () => shim.current?.stop(), [])

  // Ends a replay that is still playing and drops its label: the page's own fetch is back before the caller sends anything.
  function stop() {
    shim.current?.stop()
    shim.current = null
    setInfo(null)
  }

  return { info, stop }
}
