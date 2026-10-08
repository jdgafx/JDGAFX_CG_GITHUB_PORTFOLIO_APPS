import { Command } from '@langchain/langgraph'
import type { HumanDecision, ReviewPayload, ThreadView } from '../../src/types'
import { GraphGateSaver } from './blobs-saver'
import { buildGraph, type GraphInstance } from './graph'
import type { StreamEvent } from './events'
import { FrameMapper } from './mapper'
import { ProviderError, type ChatFn } from './openrouter'
import type { GraphValues } from './state'
import { guardStore, storeTimeoutOf, type KeyValueStore, type StorageKind } from './store'
import { buildResult, threadViewOf } from './thread-view'
import { getThreadEntry, titleFor, upsertThread } from './thread-index'

export const RUN_BUDGET_MESSAGE = 'The run took longer than 40 seconds and was stopped. The thread is marked failed.'
export const GENERIC_RUN_FAILURE = 'The run stopped before it finished. The thread is marked failed.'

export type Send = (event: StreamEvent) => void

/** Everything a run needs from outside. Tests pass a fake store, a mock chat and a fixed clock. */
export interface RunDeps {
  store: KeyValueStore
  storage: StorageKind
  chat: ChatFn
  now: () => Date
}

type GraphInput = Parameters<GraphInstance['stream']>[0]

/** Reads never call the model, so they get a chat function that refuses. */
const NO_MODEL: ChatFn = () => Promise.reject(new Error('This read does not call the model.'))

/** The graph, with its checkpoints behind the store, bounded by `signal` and by the per-call limit. */
function graphFor(deps: RunDeps, chat: ChatFn, signal?: AbortSignal): GraphInstance {
  return buildGraph({ chat, now: deps.now, checkpointer: new GraphGateSaver(guardStore(deps.store, signal)) })
}

/** The message the visitor sees for a failed run. Provider and store messages are plain; anything else is generic. */
function userMessage(err: unknown): string {
  const cause = err instanceof Error ? err.cause : undefined
  for (const candidate of [err, cause]) {
    if (candidate instanceof ProviderError) return candidate.message
  }
  return storeTimeoutOf(err)?.message ?? GENERIC_RUN_FAILURE
}

/**
 * Writes the thread's row. These calls have the per-call limit but not the run budget, so a run that
 * used its whole budget can still record how it ended. Two calls of 8 s each keep the request under 60 s.
 */
async function recordThread(
  deps: RunDeps,
  threadId: string,
  title: string,
  status: 'awaiting_approval' | 'completed' | 'failed',
  amount: number | null,
): Promise<void> {
  try {
    await upsertThread(guardStore(deps.store), { id: threadId, title, status, amount }, deps.now())
  } catch (err) {
    console.error('GraphGate: could not update the thread index', err)
  }
}

interface Attempt {
  threadId: string
  title: string
  /** The amount to index if this attempt fails. */
  failedAmount: number | null
  input: GraphInput
  budget: AbortSignal
  send: Send
}

/**
 * Streams one graph run to the client. It ends in one of three ways: paused at the review
 * interrupt, completed with a result, or failed with an error. The thread index is updated for
 * each. The caller always sends [DONE] after this returns.
 */
async function drive(deps: RunDeps, attempt: Attempt): Promise<void> {
  const graph = graphFor(deps, deps.chat, attempt.budget)
  const mapper = new FrameMapper(attempt.threadId, attempt.send)
  attempt.send({ type: 'thread', threadId: attempt.threadId })
  try {
    const stream = await graph.stream(attempt.input, {
      streamMode: ['updates', 'custom'],
      configurable: { thread_id: attempt.threadId },
      signal: attempt.budget,
    })
    for await (const [mode, chunk] of stream) {
      if (mode === 'custom') mapper.onCustom(chunk)
      else mapper.onUpdates(chunk)
    }
    if (mapper.paused) {
      await recordThread(deps, attempt.threadId, attempt.title, 'awaiting_approval', mapper.proposalAmount)
      return
    }
    const snapshot = await graph.getState({ configurable: { thread_id: attempt.threadId } })
    const result = buildResult(attempt.threadId, snapshot.values as GraphValues)
    attempt.send({ type: 'result', result })
    await recordThread(deps, attempt.threadId, attempt.title, 'completed', result.amount)
  } catch (err) {
    console.error('GraphGate: run failed', err)
    const message = attempt.budget.aborted ? RUN_BUDGET_MESSAGE : userMessage(err)
    mapper.failCurrent(message)
    attempt.send({ type: 'error', message })
    await recordThread(deps, attempt.threadId, attempt.title, 'failed', attempt.failedAmount)
  }
}

/** Starts a new thread for one ticket and runs it until the review pause or the end. */
export function startRun(
  deps: RunDeps,
  args: { ticket: string; threadId: string; budget: AbortSignal; send: Send },
): Promise<void> {
  return drive(deps, {
    threadId: args.threadId,
    title: titleFor(args.ticket),
    failedAmount: null,
    input: { ticket: args.ticket },
    budget: args.budget,
    send: args.send,
  })
}

/** Continues a paused thread from its checkpoint with the human's answer. */
export function resumeRun(
  deps: RunDeps,
  args: { threadId: string; title: string; failedAmount: number | null; answer: HumanDecision; budget: AbortSignal; send: Send },
): Promise<void> {
  return drive(deps, {
    threadId: args.threadId,
    title: args.title,
    failedAmount: args.failedAmount,
    input: new Command({ resume: args.answer }),
    budget: args.budget,
    send: args.send,
  })
}

async function snapshotOf(
  deps: RunDeps,
  threadId: string,
  signal?: AbortSignal,
): Promise<{ values: GraphValues; proposal: ReviewPayload | null }> {
  const snapshot = await graphFor(deps, NO_MODEL, signal).getState({ configurable: { thread_id: threadId } })
  const pending = snapshot.tasks.flatMap((task) => task.interrupts)[0]
  return {
    values: snapshot.values as GraphValues,
    proposal: pending ? (pending.value as ReviewPayload) : null,
  }
}

/** The proposal the thread is waiting on, or null when nothing is pending. */
export async function pendingReview(deps: RunDeps, threadId: string, signal?: AbortSignal): Promise<ReviewPayload | null> {
  return (await snapshotOf(deps, threadId, signal)).proposal
}

/** One thread for the read endpoint, or null when the index does not list it. */
export async function readThread(deps: RunDeps, threadId: string, signal?: AbortSignal): Promise<ThreadView | null> {
  const entry = await getThreadEntry(guardStore(deps.store, signal), threadId)
  if (!entry) return null
  const { values, proposal } = await snapshotOf(deps, threadId, signal)
  return threadViewOf({ threadId, entry, storage: deps.storage, values, proposal })
}
