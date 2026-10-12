import type { NodeCall } from './graph/nodes'

/**
 * What a failed model step still spent: the call the provider answered (its usage is billed whatever came of the
 * reply), and how many calls were made whose usage never arrived (a timeout, a dropped connection, an abort).
 */
export interface Spent {
  call: NodeCall | null
  unreported: number
}

/** An error whose message is safe to show to a visitor. Never put a provider body or a key in one. */
export class PlainError extends Error {
  readonly status: number
  /** Set by a step that made a model call before it failed, so the trace row and the totals can count that call. */
  spent?: Spent

  constructor(status: number, message: string) {
    super(message)
    this.name = 'PlainError'
    this.status = status
  }
}

/** What the failed step spent, found the way `plainMessageOf` finds a message: through wrappers and causes. */
export function spentOf(err: unknown, depth = 0): Spent | null {
  if (err instanceof PlainError && err.spent) return err.spent
  if (depth >= 4) return null
  if (err instanceof AggregateError) {
    for (const inner of err.errors) {
      const spent = spentOf(inner, depth + 1)
      if (spent !== null) return spent
    }
  }
  if (err instanceof Error && err.cause !== undefined) return spentOf(err.cause, depth + 1)
  return null
}

/** The one generic message, used for failures nobody planned for. */
export const SERVER_ERROR = 'Something went wrong on the server. Please try again.'

/**
 * The visitor-safe message inside an error, or null when there is none. A runtime may wrap a
 * node's error in an AggregateError or a cause, so the search looks through both. Anything
 * else returns null, so no internal text can reach a visitor.
 */
export function plainMessageOf(err: unknown, depth = 0): string | null {
  if (err instanceof PlainError) return err.message
  if (depth >= 4) return null
  if (err instanceof AggregateError) {
    for (const inner of err.errors) {
      const message = plainMessageOf(inner, depth + 1)
      if (message !== null) return message
    }
  }
  if (err instanceof Error && err.cause !== undefined) return plainMessageOf(err.cause, depth + 1)
  return null
}
