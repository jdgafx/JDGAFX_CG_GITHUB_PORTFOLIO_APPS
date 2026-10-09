import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import type { DuplicateCandidate, DuplicateReport, IssueInput, TraceStatus } from '../../src/types'
import { confirmedDuplicate, DUPLICATES_MAX_TOKENS, JUDGE_PROMPT, judgeMessage, readJudgements } from './duplicate-judge'
import {
  buildQueries,
  JUDGE_COUNT,
  mergeFound,
  rankCandidates,
  searchTerms,
  worthJudging,
  type SearchedIssue,
} from './duplicate-rank'
import { SearchError, type SearchFn } from './github-search'
import { MODEL } from './models'
import { announce, required, runChat, signalOf, traceRow, type CallRecord, type NodeDeps } from './nodes'
import { ProviderError } from './openrouter'
import type { GraphValues } from './state'

/** The search and the judge need about this long when healthy: two parallel searches, one model call, and the reply call after. */
const MIN_REMAINING_MS = 10_000

const emptyReport = (status: DuplicateReport['status'], message: string | null, terms: string[] = []): DuplicateReport => ({
  status,
  message,
  terms,
  candidates: [],
  confirmed: null,
})

interface Outcome {
  report: DuplicateReport
  status: TraceStatus
  detail: string
  call?: CallRecord
}

/** Both searches, each in GitHub's best-match order. One failing is fine; both failing is the failure that is reported. */
async function searchBoth(search: SearchFn, queries: { strict: string; broad: string }, signal: AbortSignal): Promise<{ found: SearchedIssue[]; error: SearchError | null }> {
  const settled = await Promise.allSettled([search(queries.strict, signal), search(queries.broad, signal)])
  const lists = settled.flatMap((entry) => (entry.status === 'fulfilled' ? [entry.value] : []))
  const failure = settled.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
  const error = failure ? (failure.reason instanceof SearchError ? failure.reason : new SearchError('The duplicate search failed.')) : null
  return { found: mergeFound(...lists), error: lists.length === 0 ? error : null }
}

function tally(candidates: readonly DuplicateCandidate[]): string {
  const count = (verdict: string) => candidates.filter((candidate) => candidate.judgement?.verdict === verdict).length
  const parts = [`${count('duplicate')} duplicate`, `${count('related')} related`, `${count('not')} not`]
  const unverified = count('unverified')
  if (unverified > 0) parts.push(`${unverified} not accepted (quotes not found)`)
  return parts.join(', ')
}

async function check(issue: IssueInput, deps: NodeDeps, signal: AbortSignal): Promise<Outcome> {
  if (!deps.search || deps.remainingMs() < MIN_REMAINING_MS) {
    const message = 'Skipped: not enough time was left in this request. Triage the issue again to run the duplicate check.'
    return { report: emptyReport('skipped', message), status: 'skipped', detail: message }
  }
  const terms = searchTerms(issue.title, issue.body, issue.repo)
  if (terms.length === 0) {
    const message = 'The title has no words worth searching for.'
    return { report: emptyReport('none', message), status: 'ok', detail: message }
  }
  const { found, error } = await searchBoth(deps.search, buildQueries(issue.repo, terms), signal)
  if (error) {
    const message = `${error.message} The triage continues without a duplicate check.`
    return { report: emptyReport('unavailable', message, terms), status: 'failed', detail: message }
  }
  const ranked = rankCandidates(issue, found)
  if (ranked.length === 0) {
    const message = `No other issue in ${issue.repo} matched the search for ${terms.join(', ')}.`
    return { report: emptyReport('none', message, terms), status: 'ok', detail: message }
  }
  const toJudge = ranked.filter(worthJudging).slice(0, JUDGE_COUNT)
  if (toJudge.length === 0) {
    const message = `${ranked.length} issue${ranked.length === 1 ? '' : 's'} matched the search, but none shares enough rare words to ask the model about.`
    return { report: { status: 'none', message, terms, candidates: ranked, confirmed: null }, status: 'ok', detail: message }
  }

  const items = toJudge.map((candidate) => found.find((item) => item.number === candidate.number) as SearchedIssue)
  let call: CallRecord
  try {
    call = await runChat(
      deps,
      MODEL,
      DUPLICATES_MAX_TOKENS,
      { system: JUDGE_PROMPT, user: judgeMessage(issue, items), json: true },
      signal,
      1,
    )
  } catch (err) {
    // A run that is out of time stops here. A slow or refusing model costs only the verdicts.
    if (signal.aborted || !(err instanceof ProviderError)) throw err
    const message = `The model could not judge the candidates (${err.message}) The ranked candidates are shown without verdicts.`
    return { report: { status: 'unavailable', message, terms, candidates: ranked, confirmed: null }, status: 'failed', detail: message }
  }
  const judgements = readJudgements(call.result.text, issue, items)
  const candidates = ranked.map((candidate) => ({ ...candidate, judgement: judgements.get(candidate.number) ?? null }))
  const confirmed = confirmedDuplicate(candidates)
  const judged = candidates.filter((candidate) => candidate.judgement !== null)
  const report: DuplicateReport = { status: 'checked', message: null, terms, candidates, confirmed: confirmed?.number ?? null }
  const detail =
    judged.length === 0
      ? `Ranked ${ranked.length} candidates, but the model's reply could not be read, so none has a verdict.`
      : `Ranked ${ranked.length} candidates by rare shared words and asked the model about the top ${toJudge.length}: ${tally(candidates)}.`
  return { report, status: judged.length === 0 ? 'failed' : 'ok', detail, call }
}

/** Finds likely duplicates among the repo's own issues. Search and ranking are rules; the model only judges the top few. */
export async function duplicatesNode(state: GraphValues, config: LangGraphRunnableConfig, deps: NodeDeps): Promise<Partial<GraphValues>> {
  announce(config, 'duplicates')
  const started = Date.now()
  const issue = required(state.issue, 'the issue')
  const outcome = await check(issue, deps, signalOf(config))
  return {
    duplicateReport: outcome.report,
    trace: [traceRow('duplicates', started, outcome.status, outcome.detail, outcome.call)],
  }
}
