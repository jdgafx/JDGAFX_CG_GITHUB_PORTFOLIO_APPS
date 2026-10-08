import { interrupt, type LangGraphRunnableConfig } from '@langchain/langgraph'
import { formatUsd } from '../../src/lib/money'
import { findOrder, sampleOrders } from '../../src/lib/orders'
import type {
  Decision,
  DecisionAction,
  Extracted,
  HumanDecision,
  Issue,
  NodeName,
  Reply,
  ReviewPayload,
  TokenUsage,
  TraceRow,
  TraceStatus,
} from '../../src/types'
import { isRecord } from './guard'
import { DECIDE_MAX_TOKENS, DECIDE_MODEL, INTAKE_MAX_TOKENS, INTAKE_MODEL, REPLY_MAX_TOKENS, REPLY_MODEL, estimateCost } from './models'
import type { ChatFn, ChatRequest, ChatResult } from './openrouter'
import { evaluatePolicy, resolveDecision } from './policy'
import type { GraphValues } from './state'

export interface NodeDeps {
  chat: ChatFn
  now: () => Date
}

interface CallRecord {
  requested: string
  result: ChatResult
}

const UNREADABLE_EXTRACTION: Extracted = { orderId: null, issue: 'other', requestedAmount: null }
const ISSUES: readonly Issue[] = ['duplicate_charge', 'defective_item', 'other']
const ORDER_ID = /^ORD-\d{4}$/
const RATIONALE_MAX_LENGTH = 400
const NO_CANCEL = new AbortController().signal

export const INTAKE_PROMPT = [
  'You read one customer support ticket and extract facts.',
  'Reply with one JSON object and nothing else:',
  '{"orderId": "ORD-1234" or null, "issue": "duplicate_charge" or "defective_item" or "other",',
  '"requestedAmount": a number of dollars or null}.',
  'Use null when the ticket does not say. Do not decide anything.',
].join(' ')

export const DECIDE_PROMPT = [
  'You write the rationale for a refund decision that a support reviewer will read.',
  'Use only the facts given. Two sentences at most.',
  'Reply with one JSON object and nothing else: {"rationale": "..."}.',
].join(' ')

export const REPLY_PROMPT = [
  'You write a short customer support email as plain text.',
  'Use only the facts given. Quote only the amount given, and no other number.',
  'No subject line. Under 120 words. Sign off as Customer Support.',
].join(' ')

function signalOf(config: LangGraphRunnableConfig): AbortSignal {
  return config.signal ?? NO_CANCEL
}

/** Tells the stream which node is starting. The server turns this into a node_start frame. */
function announce(config: LangGraphRunnableConfig, node: NodeName): void {
  config.writer?.({ type: 'node_start', node })
}

function required<T>(value: T | null, earlier: string): T {
  if (value === null) throw new Error(`The graph reached a node before ${earlier} was set.`)
  return value
}

/** The index of the brace that closes the one at `start`, or -1. Braces inside JSON strings do not count. */
function closingBrace(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i += 1
      else if (ch === '"') inString = false
    } else if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * The first complete JSON object in a reply. A code fence, prose, or stray braces around it are
 * skipped, so a provider that ignores the JSON format still gives a readable reply.
 */
export function firstJsonObject(text: string): Record<string, unknown> | null {
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    const end = closingBrace(text, start)
    if (end < 0) continue
    try {
      const value: unknown = JSON.parse(text.slice(start, end + 1))
      if (isRecord(value)) return value
    } catch {
      // Not an object: try the next opening brace.
    }
  }
  return null
}

/** The intake facts, or null when the reply has no readable issue. A bad order id reads as null. */
export function readExtraction(text: string): Extracted | null {
  const parsed = firstJsonObject(text)
  if (!parsed || typeof parsed.issue !== 'string' || !ISSUES.includes(parsed.issue as Issue)) return null
  const orderId = typeof parsed.orderId === 'string' ? parsed.orderId.trim().toUpperCase() : ''
  const amount = parsed.requestedAmount
  return {
    orderId: ORDER_ID.test(orderId) ? orderId : null,
    issue: parsed.issue as Issue,
    requestedAmount: typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null,
  }
}

/** The rationale text, cut to a sensible length, or null when the reply has none. */
export function readRationale(text: string): string | null {
  const value = firstJsonObject(text)?.rationale
  if (typeof value !== 'string' || !value.trim()) return null
  return value.trim().slice(0, RATIONALE_MAX_LENGTH)
}

/** The human answer as the graph stores it. Anything malformed fails the run instead of guessing. */
export function readHumanDecision(value: unknown): HumanDecision {
  const raw = isRecord(value) ? value : {}
  const action = raw.action
  if (action !== 'approve' && action !== 'edit' && action !== 'reject') {
    throw new Error('The review answer was not valid.')
  }
  const answer: HumanDecision = { action }
  if (action === 'edit') {
    if (typeof raw.amount !== 'number' || !(raw.amount > 0)) throw new Error('The review answer was not valid.')
    answer.amount = raw.amount
  }
  if (typeof raw.note === 'string' && raw.note.trim()) answer.note = raw.note.trim()
  return answer
}

function outcomeText(action: DecisionAction, amount: number): string {
  return action === 'refund' ? `refund of ${formatUsd(amount)}` : 'no refund'
}

function describeAnswer(answer: HumanDecision): string {
  if (answer.action === 'edit') return `Changed the refund to ${formatUsd(answer.amount ?? 0)}.`
  if (answer.action === 'reject') return 'Rejected the refund.'
  return 'Approved the proposal.'
}

function subjectFor(action: DecisionAction, orderId: string | null): string {
  return action === 'refund' ? `Your refund for ${orderId ?? 'your order'}` : `Update on ${orderId ?? 'your request'}`
}

/** The standard wording, used only when the model returns no text. */
function fallbackBody(action: DecisionAction, amount: number, rationale: string): string {
  return action === 'refund'
    ? `We have approved a refund of ${formatUsd(amount)}. ${rationale}`
    : `Thank you for contacting us. We are not able to refund this request. ${rationale}`
}

function tokenUsageOf(result: ChatResult): TokenUsage | undefined {
  const usage: TokenUsage = {}
  const { prompt_tokens, completion_tokens, total_tokens } = result.usage
  if (prompt_tokens !== undefined) usage.prompt_tokens = prompt_tokens
  if (completion_tokens !== undefined) usage.completion_tokens = completion_tokens
  if (total_tokens !== undefined) usage.total_tokens = total_tokens
  return Object.keys(usage).length > 0 ? usage : undefined
}

/**
 * One finished node as a trace row. A model call adds the served model, the reported tokens, and
 * a cost: the provider's figure when it reported one, otherwise an estimate from the list price.
 */
export function traceRow(node: NodeName, startedAt: number, status: TraceStatus, detail: string, call?: CallRecord): TraceRow {
  const row: TraceRow = { node, status, ms: Date.now() - startedAt, detail }
  if (!call) return row
  row.model = call.result.servedModel ?? call.requested
  const usage = tokenUsageOf(call.result)
  if (usage) row.usage = usage
  const reported = call.result.usage.cost
  if (typeof reported === 'number') {
    row.cost = reported
    row.costSource = 'usage'
  } else {
    const { prompt_tokens: prompt, completion_tokens: completion } = call.result.usage
    const estimate =
      prompt !== undefined && completion !== undefined ? estimateCost(call.requested, prompt, completion) : undefined
    if (estimate !== undefined) {
      row.cost = estimate
      row.costSource = 'estimated'
    }
  }
  return row
}

async function runChat(
  deps: NodeDeps,
  model: string,
  maxTokens: number,
  prompt: { system: string; user: string; temperature: number; json?: boolean; requireParameters?: boolean },
  signal: AbortSignal,
): Promise<CallRecord> {
  const request: ChatRequest = {
    model,
    maxTokens,
    temperature: prompt.temperature,
    json: prompt.json,
    requireParameters: prompt.requireParameters,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
  }
  return { requested: model, result: await deps.chat(request, signal) }
}

/** Reads the ticket into facts. An unreadable reply still continues, and the trace marks it failed. */
export async function intakeNode(
  state: GraphValues,
  config: LangGraphRunnableConfig,
  deps: NodeDeps,
): Promise<Partial<GraphValues>> {
  announce(config, 'intake')
  const started = Date.now()
  const call = await runChat(
    deps,
    INTAKE_MODEL,
    INTAKE_MAX_TOKENS,
    // The intake model is not asked to route by parameter support. Its reply is read tolerantly instead.
    { system: INTAKE_PROMPT, user: `Ticket:\n${state.ticket}`, temperature: 0, json: true, requireParameters: false },
    signalOf(config),
  )
  const extracted = readExtraction(call.result.text)
  const detail = extracted
    ? `Read order ${extracted.orderId ?? 'none'}, issue ${extracted.issue}.`
    : 'The extraction could not be read, so a person will decide.'
  return {
    extracted: extracted ?? UNREADABLE_EXTRACTION,
    trace: [traceRow('intake', started, extracted ? 'ok' : 'failed', detail, call)],
  }
}

/** The deterministic policy tool. No model is called, so the verdict is the same on every run. */
export function policyNode(state: GraphValues, config: LangGraphRunnableConfig, deps: NodeDeps): Partial<GraphValues> {
  announce(config, 'policy')
  const started = Date.now()
  const extracted = required(state.extracted, 'intake')
  const now = deps.now()
  const order = findOrder(sampleOrders(now), extracted.orderId)
  const policyResult = evaluatePolicy({ orderId: extracted.orderId, issue: extracted.issue }, order, now)
  return { policyResult, trace: [traceRow('policy', started, 'ok', policyResult.reason)] }
}

/**
 * The model writes the rationale. The action and amount come from the policy, so the proposal the
 * human sees always matches the policy, whatever the model returns.
 */
export async function decideNode(
  state: GraphValues,
  config: LangGraphRunnableConfig,
  deps: NodeDeps,
): Promise<Partial<GraphValues>> {
  announce(config, 'decide')
  const started = Date.now()
  const policyResult = required(state.policyResult, 'policy')
  const extracted = required(state.extracted, 'intake')
  const action: DecisionAction = policyResult.eligible ? 'refund' : 'deny'
  const amount = policyResult.eligible ? policyResult.amount : 0
  const call = await runChat(
    deps,
    DECIDE_MODEL,
    DECIDE_MAX_TOKENS,
    {
      system: DECIDE_PROMPT,
      user: [
        `Ticket:\n${state.ticket}`,
        `Facts: ${JSON.stringify(extracted)}`,
        `Policy verdict: ${policyResult.reason}`,
        `Outcome: ${outcomeText(action, amount)}`,
      ].join('\n'),
      temperature: 0,
      json: true,
    },
    signalOf(config),
  )
  const rationale = readRationale(call.result.text)
  const decision: Decision = { action, amount, rationale: rationale ?? policyResult.reason }
  const detail = rationale
    ? 'Drafted the rationale. The action and amount come from the policy.'
    : 'The rationale could not be read, so the policy reason is used.'
  return {
    decision,
    status: policyResult.requiresHuman ? 'awaiting_approval' : 'running',
    trace: [traceRow('decide', started, rationale ? 'ok' : 'failed', detail, call)],
  }
}

/**
 * Pauses the run. The first pass stops at interrupt(), and the checkpoint keeps the proposal. The
 * resumed pass re-enters this node and receives the human's answer. Nothing before interrupt() may
 * cause side effects, because the node runs again from its start.
 */
export function reviewNode(state: GraphValues, config: LangGraphRunnableConfig, deps: NodeDeps): Partial<GraphValues> {
  announce(config, 'review')
  const started = Date.now()
  const proposal = required(state.decision, 'decide')
  const policyResult = required(state.policyResult, 'policy')
  const extracted = required(state.extracted, 'intake')
  const payload: ReviewPayload = {
    proposal,
    policy: policyResult,
    orderId: extracted.orderId,
    orderTotal: findOrder(sampleOrders(deps.now()), extracted.orderId)?.total ?? null,
    requestedAmount: extracted.requestedAmount,
  }
  const answer = readHumanDecision(interrupt(payload))
  return { humanDecision: answer, status: 'running', trace: [traceRow('review', started, 'ok', describeAnswer(answer))] }
}

/** Writes the customer email for the final outcome. A reject becomes a polite denial. */
export async function replyNode(
  state: GraphValues,
  config: LangGraphRunnableConfig,
  deps: NodeDeps,
): Promise<Partial<GraphValues>> {
  announce(config, 'reply')
  const started = Date.now()
  const proposal = required(state.decision, 'decide')
  const extracted = required(state.extracted, 'intake')
  const final = resolveDecision(proposal, state.humanDecision)
  const call = await runChat(
    deps,
    REPLY_MODEL,
    REPLY_MAX_TOKENS,
    {
      system: REPLY_PROMPT,
      user: [
        `Ticket:\n${state.ticket}`,
        `Order: ${extracted.orderId ?? 'not stated'}`,
        `Outcome: ${outcomeText(final.action, final.amount)}`,
        `Reason: ${proposal.rationale}`,
        `Reviewer note: ${final.note ?? 'none'}`,
      ].join('\n'),
      temperature: 0.3,
    },
    signalOf(config),
  )
  const drafted = call.result.text
  const replyEmail: Reply = {
    subject: subjectFor(final.action, extracted.orderId),
    body: drafted || fallbackBody(final.action, final.amount, proposal.rationale),
  }
  const detail = drafted
    ? `Wrote the customer email for a ${final.action === 'refund' ? 'refund' : 'denial'}.`
    : 'The model returned no text, so the standard wording is used.'
  return {
    replyEmail,
    status: 'completed',
    trace: [traceRow('reply', started, drafted ? 'ok' : 'failed', detail, call)],
  }
}
