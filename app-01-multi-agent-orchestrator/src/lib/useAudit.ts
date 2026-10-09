import { useCallback, useEffect, useRef, useState } from 'react'
import type { Source } from '../types'
import { summarize } from './audit'
import { isAbortError } from './api'
import { auditErrorMessage, requestAudit } from './auditApi'
import { IDLE_AUDIT, giveUp, pendingClaims, type AuditView } from './auditState'

/** The audit of a finished report: starts on request, can be stopped, retried or reset. */
export function useAudit() {
  const [view, setView] = useState<AuditView>(IDLE_AUDIT)
  const abortRef = useRef<AbortController | null>(null)
  const lastRef = useRef<{ report: string; sources: Source[] } | null>(null)
  // The view the failure handlers settle from, so a stop does not read a stale render.
  const viewRef = useRef<AuditView>(IDLE_AUDIT)
  const set = useCallback((next: AuditView) => {
    viewRef.current = next
    setView(next)
  }, [])

  const start = useCallback(
    async (report: string, sources: Source[]) => {
      abortRef.current?.abort()
      lastRef.current = { report, sources }
      const claims = pendingClaims(report, sources)
      if (claims.length === 0) {
        set({
          phase: 'none',
          claims: [],
          summary: summarize([]),
          note: report.trim() ? 'The report cites no source, so there is nothing to check.' : 'No report was written, so there is nothing to check.',
        })
        return
      }
      const pending: AuditView = { phase: 'running', claims, summary: summarize(claims) }
      set(pending)
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const result = await requestAudit(report, sources, controller.signal)
        if (controller.signal.aborted) return
        set({ phase: 'done', claims: result.claims, summary: result.summary, result })
      } catch (err) {
        if (isAbortError(err) || controller.signal.aborted) return
        set(giveUp(pending, 'failed', auditErrorMessage(err)))
      } finally {
        if (abortRef.current === controller) abortRef.current = null
      }
    },
    [set],
  )

  const stop = useCallback(() => {
    if (!abortRef.current) return
    abortRef.current.abort()
    abortRef.current = null
    set(giveUp(viewRef.current, 'stopped'))
  }, [set])

  const retry = useCallback(() => {
    const last = lastRef.current
    if (last) void start(last.report, last.sources)
  }, [start])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    lastRef.current = null
    set(IDLE_AUDIT)
  }, [set])

  useEffect(() => () => abortRef.current?.abort(), [])

  return { view, start, stop, retry, reset }
}
