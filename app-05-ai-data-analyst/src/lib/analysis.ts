import { askData, sampleFor } from './api'
import { executeQuery, topGroup } from './dataEngine'
import { unansweredMessage } from './grounding'
import { diffPlans } from './planDiff'
import { answerDirection, applyCountColumn, applyQuestionDirection, applyQuestionLimit, applyQuestionTotal, dropUnaskedLimit, isTotal, validateQueryPlan } from './queryPlan'
import type { QuestionNouns } from './questionNouns'
import { labelFor, RAW_VOCABULARY, shownLabel } from './vocabulary'
import type { AnalysisResult, EngineResult, ParsedData, PlanChange, RunStep, RunView, Vocabulary } from '../types'

export interface StepRequest {
  question: string
  data: ParsedData
  dataset: string
  vocab?: Vocabulary
  /** Set on a follow-up: the result the new plan refines. */
  previous?: AnalysisResult
}

/** What one run produced. A failed plan check carries the run so far; every other failure is thrown by askData. */
export type StepOutcome =
  | { kind: 'done'; result: AnalysisResult; changes: PlanChange[]; run: RunView }
  | { kind: 'not-applied'; reason: string; result: AnalysisResult; run: RunView }
  /** A new question the model reports as having nothing to do with the data: no chart and no number, only the reason. The model call it cost is in the run. */
  | { kind: 'unanswered'; message: string; run: RunView }
  | { kind: 'invalid'; error: string; run: RunView }

function groupsDetail(engine: EngineResult, direction: 'highest' | 'lowest', top: ReturnType<typeof topGroup>, vocab: Vocabulary, total = false): string {
  if (total) {
    return engine.labels.length > 0
      ? 'One total over all the rows that passed the filters, not split into groups.'
      : 'No row passed the filters with a number to total, so there is no total.'
  }
  if (engine.having) return `${engine.labels.length} of ${engine.having.total} groups meet the threshold.`
  if (!top) return 'No rows matched, so there are no groups.'
  const tie = top.tied.length > 1 ? ` and ${top.tied.length - 1} more tie` : ''
  const cut = engine.limited ? ` Kept ${engine.labels.length} of ${engine.limited.total}.` : ''
  return `${engine.labels.length} groups. ${direction === 'lowest' ? 'Lowest' : 'Highest'}: ${shownLabel(vocab, top.label)}${tie}.${cut}`
}

/**
 * One planning round: ask the model for a plan (a new one, or the previous one refined), check it
 * against the columns again, and run it on every row in the browser. Throws CancelledError when the
 * visitor stops and AnalysisRunError when the request fails, both from askData.
 */
export async function planAndRun(request: StepRequest, signal: AbortSignal): Promise<StepOutcome> {
  const { question, data, dataset, previous } = request
  const vocab = request.vocab ?? RAW_VOCABULARY
  const response = await askData(
    {
      question,
      headers: data.headers,
      sampleRows: sampleFor(data),
      rowCount: data.rows.length,
      ...(previous ? { previous: { question: previous.question, plan: previous.queryPlan } } : {}),
    },
    { signal },
  )
  const summary = { usage: response.usage, model: response.model, totalMs: response.totalMs }

  // Second gate: the function already checked the plan, but a plan never reaches the engine,
  // and never renders as a chart, without matching this dataset.
  const checkAt = Date.now()
  const validation = validateQueryPlan(response.result, data.headers)
  if (!validation.ok) {
    const step: RunStep = { name: 'Check plan in the browser', status: 'failed', ms: Date.now() - checkAt, detail: validation.error }
    return { kind: 'invalid', error: validation.error, run: { ...summary, trace: [...response.trace, step], outcome: 'failed' } }
  }

  if (previous && validation.plan.cannotApply) {
    const step: RunStep = {
      name: 'Run plan on the rows',
      status: 'skipped',
      ms: 0,
      detail: 'Not run: the follow-up could not be applied, so the previous result stands.',
    }
    return {
      kind: 'not-applied',
      reason: validation.plan.cannotApply,
      result: previous,
      run: { ...summary, trace: [...response.trace, step], outcome: 'done' },
    }
  }

  // The row noun and every column name and label, so "how many countries had earthquakes?" is not read as a row total.
  const columns = data.headers.map((header) => ({ header, label: labelFor(vocab, header) }))
  const names: QuestionNouns = {
    rowNoun: vocab.rowNoun,
    nouns: columns.flatMap((column) => [column.header, column.label]),
    columns,
  }

  // A new question the model reports as having nothing to do with this dataset is not drawn: the page says so and shows no number.
  if (!previous && validation.plan.aboutData === false) {
    const step: RunStep = {
      name: 'Run plan on the rows',
      status: 'skipped',
      ms: 0,
      detail: 'Not run: the model reported that the question is not about this dataset, so there is nothing to compute.',
    }
    return { kind: 'unanswered', message: unansweredMessage(names, vocab), run: { ...summary, trace: [...response.trace, step], outcome: 'done' } }
  }

  const asked = dropUnaskedLimit(validation.plan, question, previous?.queryPlan.limit)
  // What the model counts is checked here, where the question and columns are both known.
  const grouped = applyCountColumn(asked, question, names, data.rows, vocab)
  // The count the question names is applied once the plan is known to be grouped, and before the direction, which then finds the sort in place.
  const plan = applyQuestionTotal(applyQuestionDirection(applyQuestionLimit(grouped, question), question), question, names)
  const executeAt = Date.now()
  const engine = executeQuery(data, plan)
  const direction = answerDirection(plan)
  const top = topGroup(engine, direction)
  const reranked = plan.sortBy !== validation.plan.sortBy ? ` Sorted by ${plan.aggregate.field}, ${direction} first, to match the question.` : ''
  const runStep: RunStep = {
    name: 'Run plan on the rows',
    status: 'ok',
    ms: Date.now() - executeAt,
    detail: groupsDetail(engine, direction, top, vocab, isTotal(plan)) + (isTotal(plan) ? '' : reranked),
  }
  const result: AnalysisResult = { ...engine, queryPlan: plan, question, dataset, vocab, columnNouns: names.nouns }
  return {
    kind: 'done',
    result,
    changes: previous ? diffPlans(previous.queryPlan, plan, vocab) : [],
    run: { ...summary, trace: [...response.trace, runStep], outcome: 'done' },
  }
}
