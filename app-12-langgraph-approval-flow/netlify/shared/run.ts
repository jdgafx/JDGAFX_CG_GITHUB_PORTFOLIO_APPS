import { Command } from '@langchain/langgraph'
import type { HumanDecision, IssueInput, NodeName, Priority, ReviewPayload, ThreadEntry, ThreadStatus, ThreadView } from '../../src/types'
import { GraphGateSaver } from './blobs-saver'
import { buildGraph, type GraphInstance } from './graph'
import type { StreamEvent } from './events'
import { FrameMapper } from './mapper'
import { CALL_TIMEOUT_MS, ProviderError, type ChatFn } from './openrouter'
import type { GraphValues } from './state'
import { guardStore, storeTimeoutOf, type KeyValueStore, type StorageKind } from './store'
import { RUN_BUDGET_MS } from './budget'
import { buildResult, threadViewOf } from './thread-view'
import { getThreadEntry, titleFor, writeThread } from './thread-index'

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
 * Threads this function instance is running or resuming. A second resume or retry for one of them is
 * refused. This guards one instance only, not a race across instances.
 */
export const inFlight = new Set<string>()

/**
 * Writes the thread's own summary. These calls have the per-call limit but not the run budget, so a run
 * that used its whole budget can still record how it ended. A failed write is tried once more and then
 * logged with the thread id. The list may then be stale, but the checkpoint is not, and opening the
 * thread repairs the summary.
 */
async function recordThread(
  deps: RunDeps,
  threadId: string,
  meta: ThreadMeta,
  status: ThreadStatus,
  priority: Priority | null,
): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await writeThread(guardStore(deps.store), { id: threadId, ...meta, status, priority }, deps.now())
      return
    } catch (err) {
      console.error(`GraphGate: could not write the summary of thread ${threadId} (attempt ${attempt})`, err)
    }
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
  inFlight.add(attempt.threadId)
  try {
    await driveStream(deps, attempt)
  } finally {
    inFlight.delete(attempt.threadId)
  }
}

async function driveStream(deps: RunDeps, attempt: Attempt): Promise<void> {
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

/** A thread as its checkpoint shows it, with the summary corrected to match. */
export interface InspectedThread {
  entry: ThreadEntry
  values: GraphValues
  /** The pending review, when the checkpoint is stopped at the interrupt. */
  proposal: ReviewPayload | null
  /** True when the checkpoint still has a step to run. */
  hasNext: boolean
}

/**
 * The thread's state from its checkpoint, which is the source of truth: interrupted means awaiting a
 * maintainer, finished with a reply means completed, and anything else means the run stopped and failed.
 * The summary only supplies the title and the priority. When it is missing or says something else, it is
 * rewritten, so a lost or late summary write cannot strand a thread. Null when the thread has no issue in
 * its checkpoint: it never existed, or was saved by the refund version.
 */
export async function inspectThread(deps: RunDeps, threadId: string, signal?: AbortSignal): Promise<InspectedThread | null> {
  const stored = await getThreadEntry(guardStore(deps.store, signal), threadId)
  const { values, proposal, hasNext } = await snapshotOf(deps, threadId, signal)
  if (!values.issue) return null
  const status: ThreadStatus = proposal
    ? 'awaiting_approval'
    : !hasNext && values.triage !== null && values.replyDraft !== null
      ? 'completed'
      : 'failed'
  const priority = proposal ? proposal.triage.priority : (stored?.priority ?? values.triage?.priority ?? null)
  const meta = { title: stored?.title ?? titleFor(values.issue), repo: values.issue.repo, number: values.issue.number }
  if (stored?.status === status && stored.priority === priority) return { entry: stored, values, proposal, hasNext }
  const entry: ThreadEntry = { id: threadId, ...meta, status, priority, updatedAt: deps.now().toISOString() }
  await recordThread(deps, threadId, meta, status, priority)
  return { entry, values, proposal, hasNext }
}

/** One thread for the read endpoint, or null when its checkpoint has no issue. */
export async function readThread(deps: RunDeps, threadId: string, signal?: AbortSignal): Promise<ThreadView | null> {
  const info = await inspectThread(deps, threadId, signal)
  if (!info) return null
  return threadViewOf({
    threadId,
    entry: info.entry,
    storage: deps.storage,
    values: info.values,
    proposal: info.proposal,
    retryable: info.entry.status === 'failed' && info.hasNext,
  })
}
