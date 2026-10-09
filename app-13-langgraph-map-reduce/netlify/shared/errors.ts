/** Failure classes shared by the model client, the graph nodes and the pipeline. Messages are plain and user-facing. */

export type ProviderKind = 'rejected' | 'rate_limited' | 'bad_request' | 'timeout' | 'unavailable' | 'network'

const PROVIDER_MESSAGES: Record<ProviderKind, string> = {
  rejected: 'The AI provider rejected the key or is out of credit.',
  rate_limited: 'Rate limited, try again in a minute.',
  bad_request: 'The AI provider rejected the request.',
  timeout: 'The AI provider did not answer in time.',
  unavailable: 'The AI provider did not answer in time.',
  network: 'Could not reach the AI provider.',
}

export class ProviderError extends Error {
  readonly kind: ProviderKind

  constructor(kind: ProviderKind) {
    super(PROVIDER_MESSAGES[kind])
    this.name = 'ProviderError'
    this.kind = kind
  }

  /**
   * Only a rejected key or an empty credit account halts the parallel calls of a run. Any other
   * failure costs one call at most: a chunk, the review, or the pass it belongs to.
   */
  get fatal(): boolean {
    return this.kind === 'rejected'
  }
}

export const BUDGET_MESSAGE = 'The run ran out of time before it finished. Try again.'
/** Added to the budget message only for a text long enough that its length may have been the cause. */
export const LONG_TEXT_HINT = ' A shorter text also helps.'

export class RunBudgetError extends Error {
  constructor() {
    super(BUDGET_MESSAGE)
    this.name = 'RunBudgetError'
  }
}

/** A stage could not produce a result for a reason the user can act on. */
export class RunFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunFailure'
  }
}

export const SERVER_MESSAGE = 'Something went wrong on the server. Try again.'

/**
 * LangGraph wraps failures from several parallel tasks in one AggregateError. This returns the failure
 * to report: a fatal one first, then any known one, otherwise the error itself.
 */
export function reportedFailure(err: unknown): unknown {
  if (!(err instanceof AggregateError)) return err
  const known = err.errors.filter((e) => e instanceof ProviderError || e instanceof RunBudgetError || e instanceof RunFailure)
  return known.find((e) => isFatal(e)) ?? known[0] ?? err
}

export function isFatal(err: unknown): boolean {
  if (err instanceof ProviderError) return err.fatal
  return err instanceof RunBudgetError || err instanceof RunFailure
}

/** The text an error frame carries. Anything unknown becomes the generic server message. */
export function plainMessage(err: unknown, budgetExpired: boolean): string {
  if (err instanceof ProviderError || err instanceof RunBudgetError || err instanceof RunFailure) return err.message
  if (budgetExpired) return BUDGET_MESSAGE
  return SERVER_MESSAGE
}
