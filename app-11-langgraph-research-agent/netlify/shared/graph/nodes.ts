import { citedNumbers, finishAnswer } from '../citations'
import type { EndingView, NodeStatus } from '../events'
import { PlainError, type Spent } from '../errors'
import { MAX_TOKENS, NODE_MODEL, STEP_NEEDS_MS } from '../models'
import { servedMismatch } from '../pricing'
import {
  isRetryable,
  isUnreported,
  type AssistantToolCall,
  type ChatFn,
  type ChatMessage,
  type ChatReply,
  type ChatRequest,
  type ToolCall,
} from '../openrouter'
import type { WebTools } from '../websearch'
import type { WikiTools } from '../wikipedia'
import { groundedIssues, issueNotes, parseCritic, parseQueries, type CriticIssue } from './parse'
import { yearGapIssues } from './yearcheck'
import {
  agentSystem,
  CRITIC_SYSTEM,
  criticUserText,
  DRAFT_SYSTEM,
  draftUserText,
  introText,
  planSystem,
  todayLine,
} from './prompts'
import { MAX_REVISIONS, MAX_TOOL_ROUNDS, type FailedLookup, type ResearchValues, type Route } from './state'
import { MAX_CALLS_PER_REPLY, numberSources, runToolCall, toolDefinitions, type ToolOutcome } from './tools'

export interface NodeContext {
  chat: ChatFn
  wiki: WikiTools
  /** The current web, or null when no search key is set. Null keeps the run on Wikipedia alone. */
  web?: WebTools | null
  signal: AbortSignal
  /** When the run budget ends, as a Date.now() value. Unset means no limit. */
  deadline?: number
  /** The clock. Tests replace it. */
  now?: () => number
  /** The newest Haiku the price list resolves the alias to. Null when the list could not be had. */
  newestModel?: Promise<string | null>
}

/** A model call a node made, kept so the trace can show its model, tokens and cost. */
export interface NodeCall {
  model: string
  reply: ChatReply
  /** True when the first attempt timed out and this reply came from the one retry. */
  retried: boolean
  /** False when the price list could not say which model is the newest, so the served model is unchecked. */
  checked: boolean
  /** Calls this step made before this reply whose usage never arrived (the timed-out first attempt of a retry). */
  unreported: number
  /** True when the reply came from a model that is not the newest, so nothing of it is used. It was still billed. */
  refused?: boolean
}

/** The most uncited sentences one revision note names. */
const UNCITED_ISSUES_MAX = 3

/** One issue per sentence of the draft that holds no source marker, found by the same rule that marks the final answer. */
function uncitedIssues(draft: string, evidence: ResearchValues['evidence'], revised: boolean): CriticIssue[] {
  return finishAnswer(draft, evidence, revised)
    .citation.uncited.slice(0, UNCITED_ISSUES_MAX)
    .map((quote) => ({ quote, fix: 'Cite the source number that supports this sentence, like [1], or the sources of every input it uses.' }))
}

/** Milliseconds left in the run budget. */
export function timeLeft(ctx: NodeContext): number {
  return ctx.deadline === undefined ? Infinity : ctx.deadline - (ctx.now ?? Date.now)()
}

const secondsLeft = (ctx: NodeContext) => `${Math.max(0, Math.floor(timeLeft(ctx) / 1000))} s`

const OUT_OF_TIME = 'out of time'
const UNCITED = 'The answer cites none of the sources it was given, so it was not shown.'
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
  /** Offer the tools. The model chooses whether to call one (tool_choice auto). */
  tools?: boolean
  json?: boolean
  /** The time that must be left for a retry to be worth it: this step again plus what must still follow. */
  retryNeedsMs: number
}

/**
 * One model call. A call that hits its own time limit is tried once more, but only when the time
 * left still covers this step again and the steps that must follow. A run-budget stop is never retried.
 */
async function callModel(ctx: NodeContext, options: CallOptions): Promise<NodeCall> {
  const today = todayLine(new Date((ctx.now ?? Date.now)()).toISOString().slice(0, 10))
  const request: ChatRequest = {
    model: NODE_MODEL,
    messages: options.messages.map((message) => (message.role === 'system' ? { ...message, content: `${message.content} ${today}` } : message)),
    max_tokens: options.maxTokens,
  }
  if (options.tools) {
    request.tools = toolDefinitions(ctx.web != null)
    request.tool_choice = 'auto'
  }
  if (options.json) request.response_format = { type: 'json_object' }
  let retried = false
  let unreported = 0
  let reply: ChatReply
  try {
    reply = await ctx.chat(request, ctx.signal)
  } catch (err) {
    if (isUnreported(err)) unreported++
    if (!isRetryable(err) || timeLeft(ctx) < options.retryNeedsMs) throw spend(err, { call: null, unreported })
    try {
      reply = await ctx.chat(request, ctx.signal)
    } catch (second) {
      if (isUnreported(second)) unreported++
      throw spend(second, { call: null, unreported })
    }
    retried = true
  }
  const newest = (await ctx.newestModel) ?? null
  const call: NodeCall = { model: NODE_MODEL, reply, retried, checked: newest !== null, unreported }
  // A reply from any model but the newest Haiku is refused here, so it is never accepted as an answer. The provider
  // still billed it, so the refusal carries the call and its usage stays in the row and the totals.
  const refused = newest === null ? null : servedMismatch(newest, reply.servedModel)
  if (refused !== null) throw spend(new PlainError(502, refused), { call: { ...call, refused: true }, unreported })
  return call
}

/** Puts what a failed step spent on its error, so the failed row and the totals count it. Returns the error. */
function spend<E>(err: E, spent: Spent): E {
  if (err instanceof PlainError) err.spent = spent
  return err
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
      { role: 'system', content: planSystem(ctx.web != null) },
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
    messages: [{ role: 'system', content: agentSystem(roundsLeft, ctx.web != null) }, ...state.messages, ...intro],
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
    state.pendingCalls.map((call) => runToolCall(call, { wiki: ctx.wiki, web: ctx.web ?? null }, ctx.signal)),
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
      failedLookups: outcomes
        .filter((outcome) => outcome.unreachable)
        .map((outcome) => ({ lookup: outcome.lookup ?? 'lookup', reason: outcome.note })),
      pendingCalls: [],
    },
    detail: [found, ...problems].join(' '),
  }
}

/** Writes the answer from the numbered sources. On a revision it also sees the critic's notes. */
export async function draftStep(state: ResearchValues, ctx: NodeContext): Promise<NodeResult> {
  // No page was read because Wikipedia did not answer: there is nothing to answer from, so the run fails here.
  if (state.evidence.length === 0 && state.failedLookups.length > 0) {
    throw new PlainError(502, `${state.failedLookups[0].reason} No page was read, so nothing was researched. Please try again.`)
  }
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
  if (text === '') throw spend(new PlainError(502, 'The draft came back empty.'), { call, unreported: call.unreported })
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
  // Checks in code first: a year gap worked out from the wrong year of a range, or a sentence with no source
  // marker, goes back without a model call.
  const gapIssues = yearGapIssues(state.question, state.draftText, state.evidence)
  const codeIssues = [...gapIssues, ...uncitedIssues(state.draftText, state.evidence, state.revisions > 0)]
  if (codeIssues.length > 0 && state.revisions < MAX_REVISIONS && timeLeft(ctx) >= NEEDS.draft + NEEDS.critic) {
    const notes = issueNotes(codeIssues)
    const revisions = state.revisions + 1
    return {
      update: { critique: { verdict: 'revise', notes, reviewed: true }, revisions, draftReviewed: true },
      detail: `${gapIssues.length > 0 ? 'Checked the year gap against the sources.' : 'Checked that every sentence cites a source.'} ${notes}`,
      route: { to: 'draft', label: `revise (${revisions} of ${MAX_REVISIONS})` },
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

const LOOKUPS_NAMED_MAX = 4

/**
 * Says which lookups did not answer, for an answer built from the pages that were read. Empty when none failed.
 * A failed web lookup is named as a search, so the note never blames Wikipedia for a web lookup it never made.
 */
export function lookupNote(failed: FailedLookup[]): string {
  if (failed.length === 0) return ''
  const named = failed.slice(0, LOOKUPS_NAMED_MAX).map(({ lookup, reason }) => `${lookup} (${reason.replace(/\.$/, '')})`)
  const more = failed.length > LOOKUPS_NAMED_MAX ? ` and ${failed.length - LOOKUPS_NAMED_MAX} more` : ''
  const who = failed.some((item) => item.lookup.startsWith('web ')) ? 'A search' : 'Wikipedia'
  return `${who} did not answer ${failed.length === 1 ? 'this lookup' : 'these lookups'}: ${named.join('; ')}${more}. The answer uses only the pages that were read.`
}

/** Adds the failed-lookup note to how the run ended. A run that would have been complete becomes partial. */
export function withLookupNote(ending: EndingView, failed: FailedLookup[]): EndingView {
  const note = lookupNote(failed)
  if (note === '') return ending
  return ending.kind === 'complete' ? { kind: 'partial', message: note } : { ...ending, message: `${ending.message} ${note}`.trim() }
}

/** Drops citation markers that name no source and lists the sources the answer cites. No model call. */
export function finalStep(state: ResearchValues): NodeResult {
  // Only a revised draft has seen the reviewer's issues, so only it can speak about them.
  const finished = finishAnswer(state.draftText, state.evidence, state.revisions > 0)
  const { text: answer, sources, citation } = finished
  // With sources read, an answer that cites none of them is not shown, whatever the critic said.
  if (state.evidence.length > 0 && sources.length === 0) throw new PlainError(502, UNCITED)
  const unreviewed = state.critique !== null && !state.critique.reviewed
  // A year gap the sources do not bear out, left after the revisions or for lack of time, is said, not hidden.
  const gapIssues = yearGapIssues(state.question, answer, state.evidence)
  const ending: EndingView = withLookupNote(
    state.ending ??
      (unreviewed
        ? { kind: 'partial', message: state.critique?.notes ?? '' }
        : gapIssues.length > 0
          ? { kind: 'partial', message: `The year gap is not confirmed by the sources. ${issueNotes(gapIssues)}` }
          : { kind: 'complete', message: '' }),
    state.failedLookups,
  )
  return {
    update: { finalAnswer: { answer, sources, truncated: state.draftTruncated, ending, citation } },
    detail:
      (sources.length > 0 ? `${sources.length} cited source(s).` : 'No source is cited.') +
      (finished.reviewRemoved > 0 ? ` Removed ${finished.reviewRemoved} sentence(s) that talked about the review.` : '') +
      (citation.uncited.length > 0 ? ` ${citation.uncited.length} of ${citation.sentences} sentence(s) carry no citation and are marked not cited.` : ''),
  }
}
