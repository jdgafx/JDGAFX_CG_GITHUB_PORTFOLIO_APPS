import { RunBudget } from '../../netlify/shared/budget'
import { validateSynthesizeBody } from '../../netlify/shared/guard'
import { openHandoff } from '../../netlify/shared/handoff'
import type { ChatFn } from '../../netlify/shared/openrouter'
import { runPipeline, type PipelineOptions } from '../../netlify/shared/pipeline'
import { withTotals } from '../../src/lib/api'
import type { Frame, Merged, RunResult, TraceRow } from '../../src/types/frames'
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
