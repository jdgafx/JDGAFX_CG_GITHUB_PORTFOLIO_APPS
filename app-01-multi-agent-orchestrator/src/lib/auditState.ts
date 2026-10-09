import { extractClaims, preCheck, reportBody, summarize } from './audit'
import type { AuditClaim, AuditResult, AuditSummary, Source } from '../types'

/**
 * idle: no report yet. none: the report has no cited sentence, or there is no report. running: the request is out.
 * done, failed, stopped: how it ended.
 */
export type AuditPhase = 'idle' | 'none' | 'running' | 'done' | 'failed' | 'stopped'

export interface AuditView {
  phase: AuditPhase
  claims: AuditClaim[]
  summary: AuditSummary
  result?: AuditResult
  error?: string
  /** Why there is nothing to check, when phase is 'none'. */
  note?: string
}

const EMPTY_SUMMARY: AuditSummary = { total: 0, supported: 0, partly: 0, unsupported: 0, unchecked: 0 }

export const IDLE_AUDIT: AuditView = { phase: 'idle', claims: [], summary: EMPTY_SUMMARY }

/** The cited sentences of a report with their pre-pass, and the verdict "checking", before the model has answered. */
export function pendingClaims(report: string, sources: Source[]): AuditClaim[] {
  return extractClaims(reportBody(report)).map<AuditClaim>(draft => ({
    ...draft,
    pre: preCheck(draft.text, draft.cites, sources),
    verdict: 'checking',
    reason: 'Being checked against the source text.',
  }))
}

/** When the audit does not finish, the sentences stay listed as not checked, with the deterministic pre-pass still shown. */
export function giveUp(view: AuditView, phase: 'failed' | 'stopped', error?: string): AuditView {
  const claims = view.claims.map<AuditClaim>(claim => ({
    ...claim,
    verdict: 'unchecked',
    reason: phase === 'stopped' ? 'You stopped the audit before this sentence was judged.' : 'The audit did not finish, so this sentence was not judged.',
  }))
  return { phase, claims, summary: summarize(claims), ...(error ? { error } : {}) }
}
