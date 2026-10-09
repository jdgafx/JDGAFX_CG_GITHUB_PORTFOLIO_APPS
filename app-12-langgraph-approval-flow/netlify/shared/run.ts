import { Command } from '@langchain/langgraph'
import type { HumanDecision, IssueInput, NodeName, Priority, ReviewPayload, ThreadEntry, ThreadView } from '../../src/types'
import { GraphGateSaver } from './blobs-saver'
import { buildGraph, type GraphInstance } from './graph'
import type { StreamEvent } from './events'
import { FrameMapper } from './mapper'
import { CALL_TIMEOUT_MS, ProviderError, type ChatFn } from './openrouter'
import type { GraphValues } from './state'
import { guardStore, storeTimeoutOf, type KeyValueStore, type StorageKind } from './store'
import { RUN_BUDGET_MS } from './budget'
import { buildResult, threadViewOf } from './thread-view'
import { getThreadEntry, titleFor, upsertThread } from './thread-index'

const GENERIC_RUN_FAILURE = 'The run stopped before it finished. The thread is marked failed.'

type Send = (event: StreamEvent) => void

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
function graphFor(deps: RunDeps, chat: ChatFn, signal?: AbortSignal, remainingMs: () => number = () => RUN_BUDGET_MS): GraphInstance {
  return buildGraph({ chat, now: deps.now, remainingMs, checkpointer: new GraphGateSaver(guardStore(deps.store, signal)) })
}

const SAVED = 'Finished steps are saved, so you can retry the thread.'

function during(node: NodeName | null): string {
  return node ? `during the ${node} step` : 'between steps'
}

/** The run's own budget ended. The model and the store were fine, so the message blames neither. */
export function budgetMessage(node: NodeName | null): string {
  return `The run reached its ${RUN_BUDGET_MS / 1000}-second budget ${during(node)} and was stopped. ${SAVED}`
}

/**
 * The message the visitor sees for a failed run. A call that passed its own limit and a run that used
 * its budget read differently. Other provider and store messages are plain; anything else is generic.
 */
function userMessage(err: unknown, node: NodeName | null): string {
  const cause = err instanceof Error ? err.cause : undefined
  for (const candidate of [err, cause]) {
    if (!(candidate instanceof ProviderError)) continue
    if (candidate.kind === 'budget') return budgetMessage(node)
    if (candidate.kind === 'timeout') {
      const twice = candidate.retried ? ', even after one automatic retry' : ''
      return `The AI provider did not answer within ${CALL_TIMEOUT_MS / 1000} seconds ${during(node)}${twice}. ${SAVED}`
    }
    return candidate.message
  }
  return storeTimeoutOf(err)?.message ?? GENERIC_RUN_FAILURE
}

/** The identity of a thread in the index: the row's title, repo and issue number. */
type ThreadMeta = Pick<ThreadEntry, 'title' | 'repo' | 'number'>

/**
 * Writes the thread's row. These calls have the per-call limit but not the run budget, so a run that
 * used its whole budget can still record how it ended. Each call stops after 8 s at most.
 */
async function recordThread(
  deps: RunDeps,
  threadId: string,
  meta: ThreadMeta,
  status: 'awaiting_approval' | 'completed' | 'failed',
  priority: Priority | null,
): Promise<void> {
  try {
    await upsertThread(guardStore(deps.store), { id: threadId, ...meta, status, priority }, deps.now())
  } catch (err) {
    console.error('GraphGate: could not update the thread index', err)
  }
}

interface Attempt {
  threadId: string
  meta: ThreadMeta
  /** The priority to index if this attempt fails. */
  failedPriority: Priority | null
  input: GraphInput
  budget: AbortSignal
  /** Milliseconds left in the request budget. Defaults to a full budget. */
  remainingMs?: () => number
  send: Send
}

/**
 * Streams one graph run to the client. It ends in one of three ways: paused at the review
 * interrupt, completed with a result, or failed with an error. The thread index is updated for
 * each. The caller always sends [DONE] after this returns.
 */
async function drive(deps: RunDeps, attempt: Attempt): Promise<void> {
  const graph = graphFor(deps, deps.chat, attempt.budget, attempt.remainingMs)
  const began = Date.now()
  let firstNodeMs: number | null = null
  const mapper = new FrameMapper(attempt.threadId, (event) => {
    if (event.type === 'node_start' && firstNodeMs === null) firstNodeMs = Date.now() - began
    attempt.send(event)
  })
  // Time before the first node runs is the checkpoint load and any cold start. It is logged, not shown.
  const logTiming = () =>
    console.info('GraphGate: run timing', { threadId: attempt.threadId, firstNodeMs, totalMs: Date.now() - began })
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
      await recordThread(deps, attempt.threadId, attempt.meta, 'awaiting_approval', mapper.proposalPriority)
      logTiming()
      return
    }
    const snapshot = await graph.getState({ configurable: { thread_id: attempt.threadId } })
    const result = buildResult(attempt.threadId, snapshot.values as GraphValues)
    attempt.send({ type: 'result', result })
    await recordThread(deps, attempt.threadId, attempt.meta, 'completed', result.priority)
    logTiming()
  } catch (err) {
    console.error('GraphGate: run failed', err)
    const node = mapper.currentNode
    const message = attempt.budget.aborted ? budgetMessage(node) : userMessage(err, node)
    mapper.failCurrent(message)
    attempt.send({ type: 'error', message })
    await recordThread(deps, attempt.threadId, attempt.meta, 'failed', attempt.failedPriority)
  }
}

/** Starts a new thread for one issue and runs it until the review pause or the end. */
export function startRun(
  deps: RunDeps,
  args: { issue: IssueInput; threadId: string; budget: AbortSignal; remainingMs?: () => number; send: Send },
): Promise<void> {
  return drive(deps, {
    threadId: args.threadId,
    meta: { title: titleFor(args.issue), repo: args.issue.repo, number: args.issue.number },
    failedPriority: null,
    input: { issue: args.issue },
    budget: args.budget,
    remainingMs: args.remainingMs,
    send: args.send,
  })
}

/** Continues a paused thread from its checkpoint with the maintainer's answer. */
export function resumeRun(
  deps: RunDeps,
  args: { threadId: string; entry: ThreadEntry; answer: HumanDecision; budget: AbortSignal; remainingMs?: () => number; send: Send },
): Promise<void> {
  const { title, repo, number, priority } = args.entry
  return drive(deps, {
    threadId: args.threadId,
    meta: { title, repo, number },
    failedPriority: priority,
    input: new Command({ resume: args.answer }),
    budget: args.budget,
    remainingMs: args.remainingMs,
    send: args.send,
  })
}

/** Continues a failed thread from its last checkpoint: the steps that finished are not run again. */
export function retryRun(
  deps: RunDeps,
  args: { threadId: string; entry: ThreadEntry; budget: AbortSignal; remainingMs?: () => number; send: Send },
): Promise<void> {
  const { title, repo, number, priority } = args.entry
  return drive(deps, {
    threadId: args.threadId,
    meta: { title, repo, number },
    failedPriority: priority,
    input: null,
    budget: args.budget,
    remainingMs: args.remainingMs,
    send: args.send,
  })
}

async function snapshotOf(
  deps: RunDeps,
  threadId: string,
  signal?: AbortSignal,
): Promise<{ values: GraphValues; proposal: ReviewPayload | null; hasNext: boolean }> {
  const snapshot = await graphFor(deps, NO_MODEL, signal).getState({ configurable: { thread_id: threadId } })
  const pending = snapshot.tasks.flatMap((task) => task.interrupts)[0]
  return {
    values: snapshot.values as GraphValues,
    proposal: pending ? (pending.value as ReviewPayload) : null,
    hasNext: snapshot.next.length > 0,
  }
}

/** True when the thread's checkpoint still has a step to run, so a retry has something to continue. */
export async function hasStepToRetry(deps: RunDeps, threadId: string, signal?: AbortSignal): Promise<boolean> {
  return (await snapshotOf(deps, threadId, signal)).hasNext
}

/** The proposal the thread is waiting on, or null when nothing is pending. */
export async function pendingReview(deps: RunDeps, threadId: string, signal?: AbortSignal): Promise<ReviewPayload | null> {
  return (await snapshotOf(deps, threadId, signal)).proposal
}

/** One thread for the read endpoint, or null when the index does not list it. */
export async function readThread(deps: RunDeps, threadId: string, signal?: AbortSignal): Promise<ThreadView | null> {
  const entry = await getThreadEntry(guardStore(deps.store, signal), threadId)
  if (!entry) return null
  const { values, proposal, hasNext } = await snapshotOf(deps, threadId, signal)
  return threadViewOf({ threadId, entry, storage: deps.storage, values, proposal, retryable: entry.status === 'failed' && hasNext })
}
