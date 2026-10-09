import { citedNumbers, sanitizeCitations, sourcesFor } from '../citations'
import type { EndingView, NodeStatus } from '../events'
import { PlainError } from '../errors'
import { MAX_TOKENS, NODE_MODEL, STEP_NEEDS_MS } from '../models'
import {
  isCallTimeout,
  type AssistantToolCall,
  type ChatFn,
  type ChatMessage,
  type ChatReply,
  type ChatRequest,
  type ToolCall,
} from '../openrouter'
import type { WikiTools } from '../wikipedia'
import { groundedIssues, issueNotes, parseCritic, parseQueries } from './parse'
import {
  agentSystem,
  CRITIC_SYSTEM,
  criticUserText,
  DRAFT_SYSTEM,
  draftUserText,
  introText,
  PLAN_SYSTEM,
} from './prompts'
import { MAX_REVISIONS, MAX_TOOL_ROUNDS, type ResearchValues, type Route } from './state'
import { MAX_CALLS_PER_REPLY, numberSources, runToolCall, TOOL_DEFINITIONS, type ToolOutcome } from './tools'

export interface NodeContext {
  chat: ChatFn
  wiki: WikiTools
  signal: AbortSignal
  /** When the run budget ends, as a Date.now() value. Unset means no limit. */
  deadline?: number
  /** The clock. Tests replace it. */
  now?: () => number
}

/** A model call a node made, kept so the trace can show its model, tokens and cost. */
export interface NodeCall {
  model: string
  reply: ChatReply
  /** True when the first attempt timed out and this reply came from the one retry. */
  retried: boolean
}

/** Milliseconds left in the run budget. */
export function timeLeft(ctx: NodeContext): number {
  return ctx.deadline === undefined ? Infinity : ctx.deadline - (ctx.now ?? Date.now)()
}

const secondsLeft = (ctx: NodeContext) => `${Math.max(0, Math.floor(timeLeft(ctx) / 1000))} s`

const OUT_OF_TIME = 'out of time'
const NEEDS = STEP_NEEDS_MS

/** What a node returns. The wrapper in build.ts adds the trace row and the route key. */
export interface NodeResult {
  update: Partial<ResearchValues>
  detail: string
  status?: NodeStatus
  route?: Route
  call?: NodeCall
}

interface CallOptions {
  maxTokens: number
  messages: ChatMessage[]
  /** Offer the tools. 'required' makes the model call one, so it cannot stop before it has read a page. */
  tools?: 'auto' | 'required'
  json?: boolean
  /** The time that must be left for a retry to be worth it: this step again plus what must still follow. */
  retryNeedsMs: number
}

/**
 * One model call. A call that hits its own time limit is tried once more, but only when the time
 * left still covers this step again and the steps that must follow. A run-budget stop is never retried.
 */
async function callModel(ctx: NodeContext, options: CallOptions): Promise<NodeCall> {
  const request: ChatRequest = {
    model: NODE_MODEL,
    messages: options.messages,
    max_tokens: options.maxTokens,
  }
  if (options.tools) {
    request.tools = TOOL_DEFINITIONS
    request.tool_choice = options.tools
  }
  if (options.json) request.response_format = { type: 'json_object' }
  try {
    return { model: NODE_MODEL, reply: await ctx.chat(request, ctx.signal), retried: false }
  } catch (err) {
    if (!isCallTimeout(err) || timeLeft(ctx) < options.retryNeedsMs) throw err
    return { model: NODE_MODEL, reply: await ctx.chat(request, ctx.signal), retried: true }
  }
}

function toAssistantCall(call: ToolCall): AssistantToolCall {
  return { id: call.id, type: 'function', function: { name: call.name, arguments: call.args } }
}

/** Turns the question into one to three search queries. An unreadable reply falls back to the question. */
export async function planStep(state: ResearchValues, ctx: NodeContext): Promise<NodeResult> {
  const call = await callModel(ctx, {
    maxTokens: MAX_TOKENS.plan,
    retryNeedsMs: NEEDS.plan + NEEDS.agent + NEEDS.tools + NEEDS.draft,
    messages: [
      { role: 'system', content: PLAN_SYSTEM },
      { role: 'user', content: `Question: ${state.question}` },
    ],
    json: true,
  })
  const queries = parseQueries(call.reply.text)
  if (queries.length === 0) {
    return {
      update: { searchQueries: [state.question.slice(0, 120)] },
      detail: 'The plan reply could not be read. Searching with the question instead.',
      call,
    }
  }
  return { update: { searchQueries: queries }, detail: `Planned searches: ${queries.join('; ')}`, call }
}

/**
 * The tool-calling agent. With no tool budget left it routes to the draft without a model
 * call. Otherwise it either asks for tools or, with none to ask for, moves on to the draft.
 */
export async function agentStep(state: ResearchValues, ctx: NodeContext): Promise<NodeResult> {
  const roundsLeft = MAX_TOOL_ROUNDS - state.toolRounds
  if (roundsLeft <= 0) {
    return {
      update: {},
      status: 'skipped',
      detail: `Tool budget spent (${MAX_TOOL_ROUNDS} of ${MAX_TOOL_ROUNDS} rounds). Moving to the draft.`,
      route: { to: 'draft', label: 'draft (tool round limit reached)' },
    }
  }
  // With a page already read, another agent turn is worth it only if a draft and its review still fit.
  if (state.evidence.length > 0 && timeLeft(ctx) < NEEDS.agent + NEEDS.draft + NEEDS.critic) {
    return {
      update: {},
      status: 'skipped',
      detail: `Time left ${secondsLeft(ctx)}: finishing with the ${state.evidence.length} page(s) already read.`,
      route: { to: 'draft', label: `draft (${OUT_OF_TIME})` },
    }
  }

  const intro: ChatMessage[] =
    state.messages.length === 0
      ? [{ role: 'user', content: introText(state.question, state.searchQueries) }]
      : []
  const call = await callModel(ctx, {
    maxTokens: MAX_TOKENS.agent,
    retryNeedsMs: NEEDS.agent + NEEDS.draft,
    messages: [{ role: 'system', content: agentSystem(roundsLeft) }, ...state.messages, ...intro],
    // A search result is not a source, so until one page is read the model must keep calling tools.
    tools: state.evidence.length === 0 ? 'required' : 'auto',
  })

  const { text, toolCalls: requested } = call.reply
  if (requested.length === 0) {
    return {
      update: {},
      detail: 'No tool call. Moving to the draft.',
      route: { to: 'draft', label: 'draft (no more searches)' },
      call,
    }
  }
  // Another round costs the tools, a new agent turn, a draft and its review. With nothing read yet, the
  // round is the only way to get a source, so it needs only the tools and a draft.
  const roundNeedsMs =
    state.evidence.length > 0 ? NEEDS.tools + NEEDS.agent + NEEDS.draft + NEEDS.critic : NEEDS.tools + NEEDS.draft
  if (timeLeft(ctx) < roundNeedsMs) {
    return {
      update: {},
      detail: `Time left ${secondsLeft(ctx)}: no more searches. Drafting with what has been read.`,
      route: { to: 'draft', label: `draft (${OUT_OF_TIME})` },
      call,
    }
  }
  // Only the first calls run. The rest are dropped before the assistant turn is saved, so every
  // tool call in the saved history has an answer and the next request stays valid.
  const toolCalls = requested.slice(0, MAX_CALLS_PER_REPLY)
  const dropped = requested.length - toolCalls.length
  const assistant: ChatMessage = {
    role: 'assistant',
    content: text === '' ? null : text,
    tool_calls: toolCalls.map(toAssistantCall),
  }
  const asked = toolCalls.map((tool) => tool.name).join(', ')
  return {
    update: { messages: [...intro, assistant], pendingCalls: toolCalls },
    detail:
      dropped > 0
        ? `Asked for ${asked}. Dropped ${dropped} beyond the limit of ${MAX_CALLS_PER_REPLY}.`
        : `Asked for ${asked}.`,
    route: { to: 'tools', label: `tools (round ${state.toolRounds + 1} of ${MAX_TOOL_ROUNDS})` },
    call,
  }
}

/** Runs the agent's tool calls in parallel. A failed call adds no source and the loop continues. */
export async function toolsStep(state: ResearchValues, ctx: NodeContext): Promise<NodeResult> {
  const outcomes: ToolOutcome[] = await Promise.all(
    state.pendingCalls.map((call) => runToolCall(call, ctx.wiki, ctx.signal)),
  )
  const { added, messages } = numberSources(outcomes, state.evidence)
  const found =
    added.length > 0 ? `New sources: ${added.map((item) => `[${item.n}] ${item.title}`).join('; ')}.` : 'No new source.'
  const problems = outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.note)
  return {
    update: {
      messages,
      evidence: added,
      toolRounds: state.toolRounds + 1,
      pendingCalls: [],
    },
    detail: [found, ...problems].join(' '),
  }
}

/** Writes the answer from the numbered sources. On a revision it also sees the critic's notes. */
export async function draftStep(state: ResearchValues, ctx: NodeContext): Promise<NodeResult> {
  const notes = state.critique?.verdict === 'revise' ? state.critique.notes : null
  const call = await callModel(ctx, {
    maxTokens: MAX_TOKENS.draft,
    retryNeedsMs: NEEDS.draft,
    messages: [
      { role: 'system', content: DRAFT_SYSTEM },
      { role: 'user', content: draftUserText(state.question, state.evidence, notes, state.draftText) },
    ],
  })
  const text = call.reply.text
  if (text === '') throw new PlainError(502, 'The draft came back empty.')
  const truncated = call.reply.finishReason === 'length'
  const detail = truncated
    ? 'The reply hit the token limit and may be cut short.'
    : `Drafted an answer citing ${citedNumbers(text).length} source number(s).`
  return { update: { draftText: text, draftTruncated: truncated, draftReviewed: false }, detail, call }
}

/**
 * Accepts the draft or asks for one revision. The revision counter moves only when the
 * draft is sent back, so the cap allows exactly MAX_REVISIONS sends back to the draft. A revision
 * needs the critic to name at least one concrete issue, and enough time for a draft and its review.
 */
export async function criticStep(state: ResearchValues, ctx: NodeContext): Promise<NodeResult> {
  if (timeLeft(ctx) < NEEDS.critic) {
    return {
      update: {
        critique: { verdict: 'accept', notes: 'Unreviewed: the time limit ended the review.', reviewed: false },
      },
      status: 'skipped',
      detail: `Time left ${secondsLeft(ctx)}: skipping the review. The draft goes out unreviewed.`,
      route: { to: 'final', label: `final (${OUT_OF_TIME})` },
    }
  }
  const call = await callModel(ctx, {
    maxTokens: MAX_TOKENS.critic,
    retryNeedsMs: NEEDS.critic,
    messages: [
      { role: 'system', content: CRITIC_SYSTEM },
      { role: 'user', content: criticUserText(state.question, state.draftText, state.evidence) },
    ],
    json: true,
  })

  const parsed = parseCritic(call.reply.text)
  if (parsed === null) {
    return {
      update: {
        critique: { verdict: 'accept', notes: 'Not reviewed: the critic reply could not be read.', reviewed: false },
      },
      detail: 'The critic reply could not be read. The draft goes out unreviewed.',
      route: { to: 'final', label: 'final (critic reply unreadable)' },
      call,
    }
  }

  // An issue counts only when it quotes words that are really in the draft or the question.
  const issues = groundedIssues(parsed.issues, state.draftText, state.question)
  const verdict = { verdict: parsed.verdict, notes: issues.length > 0 ? issueNotes(issues) : parsed.notes }
  if (verdict.verdict === 'revise' && issues.length === 0) {
    return {
      update: { critique: { verdict: 'accept', notes: verdict.notes, reviewed: true }, draftReviewed: true },
      detail: 'The critic asked for changes but quoted no problem from the draft, so the draft is accepted.',
      route: { to: 'final', label: 'final (accepted)' },
      call,
    }
  }

  if (verdict.verdict === 'accept') {
    return {
      update: { critique: { verdict: 'accept', notes: verdict.notes, reviewed: true }, draftReviewed: true },
      detail: verdict.notes || 'Accepted.',
      route: { to: 'final', label: 'final (accepted)' },
      call,
    }
  }

  const reviewed = { verdict: 'revise', notes: verdict.notes, reviewed: true } as const
  if (state.revisions >= MAX_REVISIONS) {
    return {
      update: { critique: reviewed, draftReviewed: true },
      detail: `Asked for changes, but ${MAX_REVISIONS} revisions have been used. ${verdict.notes}`.trim(),
      route: { to: 'final', label: 'final (revision limit reached)' },
      call,
    }
  }

  if (timeLeft(ctx) < NEEDS.draft + NEEDS.critic) {
    return {
      update: {
        critique: reviewed,
        draftReviewed: true,
        ending: { kind: 'partial', message: 'The critic asked for changes, but there was no time left for a revision.' },
      },
      detail: `Time left ${secondsLeft(ctx)}: no time for a revision. ${verdict.notes}`.trim(),
      route: { to: 'final', label: `final (${OUT_OF_TIME})` },
      call,
    }
  }

  const revisions = state.revisions + 1
  return {
    update: { critique: reviewed, revisions, draftReviewed: true },
    detail: verdict.notes,
    route: { to: 'draft', label: `revise (${revisions} of ${MAX_REVISIONS})` },
    call,
  }
}

/** Drops citation markers that name no source and lists the sources the answer cites. No model call. */
export function finalStep(state: ResearchValues): NodeResult {
  const answer = sanitizeCitations(state.draftText, state.evidence)
  const sources = sourcesFor(answer, state.evidence)
  const unreviewed = state.critique !== null && !state.critique.reviewed
  const ending: EndingView =
    state.ending ?? (unreviewed ? { kind: 'partial', message: state.critique?.notes ?? '' } : { kind: 'complete', message: '' })
  return {
    update: { finalAnswer: { answer, sources, truncated: state.draftTruncated, ending } },
    detail: sources.length > 0 ? `${sources.length} cited source(s).` : 'No source is cited.',
  }
}
