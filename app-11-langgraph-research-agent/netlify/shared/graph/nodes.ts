import { citedNumbers, sanitizeCitations, sourcesFor } from '../citations'
import type { NodeStatus } from '../events'
import { PlainError } from '../errors'
import { AGENT_MODEL, CRITIC_MODEL, DRAFT_MODEL, MAX_TOKENS, PLAN_MODEL, TEMPERATURE } from '../models'
import type { AssistantToolCall, ChatFn, ChatMessage, ChatReply, ChatRequest, ToolCall } from '../openrouter'
import type { WikiTools } from '../wikipedia'
import { parseCritic, parseQueries } from './parse'
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
}

/** A model call a node made, kept so the trace can show its model, tokens and cost. */
export interface NodeCall {
  model: string
  reply: ChatReply
}

/** What a node returns. The wrapper in build.ts adds the trace row and the route key. */
export interface NodeResult {
  update: Partial<ResearchValues>
  detail: string
  status?: NodeStatus
  route?: Route
  call?: NodeCall
}

interface CallOptions {
  model: string
  maxTokens: number
  messages: ChatMessage[]
  tools?: boolean
  json?: boolean
}

async function callModel(ctx: NodeContext, options: CallOptions): Promise<NodeCall> {
  const request: ChatRequest = {
    model: options.model,
    messages: options.messages,
    max_tokens: options.maxTokens,
    temperature: TEMPERATURE,
  }
  if (options.tools) {
    request.tools = TOOL_DEFINITIONS
    request.tool_choice = 'auto'
  }
  if (options.json) request.response_format = { type: 'json_object' }
  const reply = await ctx.chat(request, ctx.signal)
  return { model: options.model, reply }
}

function toAssistantCall(call: ToolCall): AssistantToolCall {
  return { id: call.id, type: 'function', function: { name: call.name, arguments: call.args } }
}

/** Turns the question into one to three search queries. An unreadable reply falls back to the question. */
export async function planStep(state: ResearchValues, ctx: NodeContext): Promise<NodeResult> {
  const call = await callModel(ctx, {
    model: PLAN_MODEL,
    maxTokens: MAX_TOKENS.plan,
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

  const intro: ChatMessage[] =
    state.messages.length === 0
      ? [{ role: 'user', content: introText(state.question, state.searchQueries) }]
      : []
  const call = await callModel(ctx, {
    model: AGENT_MODEL,
    maxTokens: MAX_TOKENS.agent,
    messages: [{ role: 'system', content: agentSystem(roundsLeft) }, ...state.messages, ...intro],
    tools: true,
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
    model: DRAFT_MODEL,
    maxTokens: MAX_TOKENS.draft,
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
  return { update: { draftText: text, draftTruncated: truncated }, detail, call }
}

/**
 * Accepts the draft or asks for one revision. The revision counter moves only when the
 * draft is sent back, so the cap allows exactly MAX_REVISIONS sends back to the draft.
 */
export async function criticStep(state: ResearchValues, ctx: NodeContext): Promise<NodeResult> {
  const call = await callModel(ctx, {
    model: CRITIC_MODEL,
    maxTokens: MAX_TOKENS.critic,
    messages: [
      { role: 'system', content: CRITIC_SYSTEM },
      { role: 'user', content: criticUserText(state.question, state.draftText, state.evidence) },
    ],
    json: true,
  })

  const verdict = parseCritic(call.reply.text)
  if (verdict === null) {
    return {
      update: {
        critique: { verdict: 'accept', notes: 'Not reviewed: the critic reply could not be read.', reviewed: false },
      },
      detail: 'The critic reply could not be read. The draft goes out unreviewed.',
      route: { to: 'final', label: 'final (critic reply unreadable)' },
      call,
    }
  }

  if (verdict.verdict === 'accept') {
    return {
      update: { critique: { verdict: 'accept', notes: verdict.notes, reviewed: true } },
      detail: verdict.notes || 'Accepted.',
      route: { to: 'final', label: 'final (accepted)' },
      call,
    }
  }

  if (state.revisions >= MAX_REVISIONS) {
    return {
      update: { critique: { verdict: 'revise', notes: verdict.notes, reviewed: true } },
      detail: `Asked for changes, but ${MAX_REVISIONS} revisions have been used. ${verdict.notes}`.trim(),
      route: { to: 'final', label: 'final (revision limit reached)' },
      call,
    }
  }

  const revisions = state.revisions + 1
  return {
    update: { critique: { verdict: 'revise', notes: verdict.notes, reviewed: true }, revisions },
    detail: verdict.notes || 'Asked for a revision.',
    route: { to: 'draft', label: `revise (${revisions} of ${MAX_REVISIONS})` },
    call,
  }
}

/** Drops citation markers that name no source and lists the sources the answer cites. No model call. */
export function finalStep(state: ResearchValues): NodeResult {
  const answer = sanitizeCitations(state.draftText, state.evidence)
  const sources = sourcesFor(answer, state.evidence)
  return {
    update: { finalAnswer: { answer, sources, truncated: state.draftTruncated } },
    detail: sources.length > 0 ? `${sources.length} cited source(s).` : 'No source is cited.',
  }
}
