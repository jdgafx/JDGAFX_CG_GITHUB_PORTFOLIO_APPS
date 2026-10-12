import type { TraceRow } from '../../src/types'
import { estimateCost } from './models'
import { ProviderError, type ChatFn, type ChatResult } from './openrouter'

/** What a step's model calls billed: the reply that counts, and the calls whose usage never arrived. */
export interface Spend {
  result?: ChatResult
  unreportedCalls: number
}

/** The spend a failed call carries on its error, found on the error or on its cause. Undefined for a failure that is not a model call's. */
export function spendOfError(err: unknown): Spend | undefined {
  const cause = err instanceof Error ? err.cause : undefined
  for (const candidate of [err, cause]) {
    if (candidate instanceof ProviderError) return { result: candidate.result, unreportedCalls: candidate.unreportedCalls }
  }
  return undefined
}

type SpendFields = Pick<TraceRow, 'model' | 'usage' | 'cost' | 'costSource' | 'unreportedCalls'>

/**
 * The model, token and cost fields of a row for what its calls billed. A reply's tokens are the provider's
 * figures, and its cost is the provider's when it reported one and an estimate from the list price otherwise.
 * A step with no usable reply gets no model, tokens or cost: nothing is invented for a call that never reported.
 */
export function spendFields({ result, unreportedCalls }: Spend): SpendFields {
  const fields: SpendFields = {}
  if (unreportedCalls > 0) fields.unreportedCalls = unreportedCalls
  if (!result) return fields
  // The model the reply named. A reply that names none is null here, never the requested alias.
  fields.model = result.servedModel ?? null
  const usage: NonNullable<TraceRow['usage']> = {}
  if (result.usage.prompt_tokens !== undefined) usage.prompt_tokens = result.usage.prompt_tokens
  if (result.usage.completion_tokens !== undefined) usage.completion_tokens = result.usage.completion_tokens
  if (result.usage.total_tokens !== undefined) usage.total_tokens = result.usage.total_tokens
  if (Object.keys(usage).length > 0) fields.usage = usage
  const reported = result.usage.cost
  if (typeof reported === 'number') {
    fields.cost = reported
    fields.costSource = 'usage'
  } else {
    const { prompt_tokens: prompt, completion_tokens: completion } = result.usage
    // Priced by the model that answered. An unnamed or unknown model gets no estimate, so no cost is shown.
    const estimate = prompt !== undefined && completion !== undefined ? estimateCost(fields.model ?? null, prompt, completion) : undefined
    if (estimate !== undefined) {
      fields.cost = estimate
      fields.costSource = 'estimated'
    }
  }
  return fields
}

/** Where the run's watch rides in the graph config, so a node can tell it that a new step has begun. */
export const WATCH_KEY = 'callWatch'

/**
 * Watches the model calls of the step now running. A failure normally carries its own spend (see spendOfError), but the
 * abort at the end of the run budget reaches the run as a plain AbortError in place of the call's error. The watch
 * knows what that call was: started and never answered, so one call whose usage cannot be known.
 */
export class CallWatch {
  private started = 0
  private known = 0
  private answered: ChatResult | undefined

  constructor(private readonly inner: ChatFn) {}

  /** The chat function the graph calls. It behaves as the inner one and keeps count. */
  readonly chat: ChatFn = async (request, signal) => {
    this.started += 1
    try {
      const result = await this.inner(request, signal)
      this.known += 1
      this.answered = result
      return result
    } catch (err) {
      // A reply that was refused, or a refusal that bills nothing, is known. Anything else is a call that never reported.
      if (err instanceof ProviderError && (err.result !== undefined || err.unreportedCalls === 0)) {
        this.known += 1
        this.answered = err.result
      }
      throw err
    }
  }

  /** A new step begins (see announce): the calls of the earlier ones are already in their own rows. */
  reset(): void {
    this.started = 0
    this.known = 0
    this.answered = undefined
  }

  /** What the step's calls billed so far, or undefined when it made no call. */
  spend(): Spend | undefined {
    return this.started === 0 ? undefined : { result: this.answered, unreportedCalls: this.started - this.known }
  }
}
