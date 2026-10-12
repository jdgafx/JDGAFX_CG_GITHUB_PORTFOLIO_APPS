import { RunBudget } from '../../netlify/shared/budget'
import { validateCompleteBody, validateSynthesizeBody } from '../../netlify/shared/guard'
import { openHandoff } from '../../netlify/shared/handoff'
import type { ChatFn } from '../../netlify/shared/openrouter'
import { runPipeline, type PipelineOptions } from '../../netlify/shared/pipeline'
import { withTotals } from '../../src/lib/api'
import type { Frame, Merged, RunResult, Summary, TraceRow } from '../../src/types/frames'
import { recordedModels } from './prices'

/** The key the tests sign hand-offs with, in place of the provider key a deployed function derives its seal from. */
export const SEAL_KEY = 'test-only-placeholder'

export interface SplitRun {
  /** Request 1's frames, then request 2's. Request 2 does not run when request 1 made no hand-off. */
  frames: Frame[]
  first: Frame[]
  second: Frame[]
  results: RunResult[]
  errors: string[]
  /** What request 1 handed over, opened. */
  merged: Merged | null
}

interface SplitOptions {
  budgetFirst?: RunBudget
  budgetSecond?: RunBudget
  /** Other pipeline options, given to both requests. */
  options?: Partial<PipelineOptions>
}

/**
 * An analysis as production runs it: request 1 (split, extract, reduce) signs its hand-off, then request 2 gets the text and
 * that hand-off through the same field check the /api/synthesize function applies, and writes the summary. Each request has
 * its own budget and its own graph. The graph that does both in one request is for in-process use and tests of its nodes only.
 */
export async function runSplit(text: string, chat: ChatFn, split: SplitOptions = {}): Promise<SplitRun> {
  const common = { text, chat, models: Promise.resolve(recordedModels()), retryPauseMs: 0, ...split.options }
  const first: Frame[] = []
  const budgetFirst = split.budgetFirst ?? new RunBudget(60_000)
  try {
    await runPipeline({ ...common, phase: 'extract', sealKey: SEAL_KEY, budget: budgetFirst, sink: (f) => first.push(f) })
  } finally {
    budgetFirst.dispose()
  }
  const second: Frame[] = []
  const handoff = first.find((f) => f.type === 'handoff')
  let merged: Merged | null = null
  if (handoff?.type === 'handoff') {
    merged = openHandoff(SEAL_KEY, text, handoff.handoff) as Merged
    const checked = validateSynthesizeBody({ text, handoff: handoff.handoff }, SEAL_KEY)
    if (!checked.ok) throw new Error(`The hand-off request 1 made was refused: ${checked.error}`)
    const budgetSecond = split.budgetSecond ?? new RunBudget(60_000)
    try {
      await runPipeline({ ...common, phase: 'synthesize', resume: checked.resume, budget: budgetSecond, sink: (f) => second.push(f) })
    } finally {
      budgetSecond.dispose()
    }
  }
  // The page's frames: the browser drops the hand-off and totals the rows of both requests into the result (api.ts).
  const joined = [...first.filter((f) => f.type !== 'handoff'), ...second]
  const rows = joined.filter((f): f is Extract<Frame, { type: 'node_end' }> => f.type === 'node_end') as TraceRow[]
  const frames = joined.map((f) => (f.type === 'result' ? { ...f, result: withTotals(f.result, rows, 0) } : f))
  return {
    frames,
    first,
    second,
    results: frames.flatMap((f) => (f.type === 'result' ? [f.result] : [])),
    errors: frames.flatMap((f) => (f.type === 'error' ? [f.message] : [])),
    merged,
  }
}

/** A budget that always says `left` ms remain, for tests of what a request does when little time is left. */
export class FixedBudget extends RunBudget {
  constructor(private readonly left: number) {
    super(60_000)
  }
  override remaining(): number {
    return this.left
  }
}

export interface CompletionRun {
  frames: Frame[]
  completion: Extract<Frame, { type: 'completion' }> | null
  errors: string[]
}

/**
 * Request 3 as production runs it, after runSplit: the browser posts the signed hand-off request 1 made, the summary request 2
 * returned, the ids the review flagged and the chunks with no stated point to /api/complete, which opens and checks them
 * before any model call.
 */
export async function runCompletion(
  text: string,
  chat: ChatFn,
  run: SplitRun,
  flagged: string[],
  options: { budget?: RunBudget; summary?: Summary; chunks?: number[] } = {},
): Promise<CompletionRun> {
  const handoff = run.first.find((f) => f.type === 'handoff')
  if (handoff?.type !== 'handoff') throw new Error('request 1 made no hand-off')
  const summary = options.summary ?? run.results[0]?.summary
  const checked = validateCompleteBody({ text, handoff: handoff.handoff, summary, flagged, chunks: options.chunks ?? [] }, SEAL_KEY)
  if (!checked.ok) throw new Error(`The completion request was refused: ${checked.error}`)
  const frames: Frame[] = []
  const budget = options.budget ?? new RunBudget(60_000)
  try {
    await runPipeline({
      text,
      chat,
      models: Promise.resolve(recordedModels()),
      retryPauseMs: 0,
      phase: 'complete',
      resume: checked.resume,
      completion: { summary: checked.summary, flagged: checked.flagged, chunks: checked.chunks },
      budget,
      sink: (f) => frames.push(f),
    })
  } finally {
    budget.dispose()
  }
  const completion = frames.find((f): f is Extract<Frame, { type: 'completion' }> => f.type === 'completion') ?? null
  return { frames, completion, errors: frames.flatMap((f) => (f.type === 'error' ? [f.message] : [])) }
}
