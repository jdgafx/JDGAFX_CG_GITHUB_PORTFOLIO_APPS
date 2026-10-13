import { useEffect, useState } from 'react'
import { fetchLead, type WikiLead } from './wikipedia'

export type WireState =
  | { status: 'loading' }
  | { status: 'ready'; lead: WikiLead; at: number }
  | { status: 'failed' }

/** Reads the topic's Wikipedia lead once, when the page loads. It never calls the model and never blocks anything else. */
export function useWikipediaLead(topic: string): WireState {
  const [state, setState] = useState<WireState>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    fetchLead(topic, controller.signal).then(
      lead => {
        if (!controller.signal.aborted) setState({ status: 'ready', lead, at: Date.now() })
      },
      () => {
        if (!controller.signal.aborted) setState({ status: 'failed' })
      },
    )
    return () => controller.abort()
  }, [topic])
  return state
}
