import type { AgentRole } from '../../src/types'

export type AgentContext = Partial<Record<AgentRole, string>>

export interface AgentConfig {
  role: AgentRole
  name: string
  systemPrompt: string
  buildUserMessage: (query: string, context: AgentContext) => string
  /** Explicit ceiling on generated tokens. Always sent upstream. */
  maxTokens: number
  /** Wall-clock cap for one attempt. The run deadline can shorten it. */
  timeoutMs: number
}

/**
 * Netlify's synchronous function limit is 60 s and cannot be configured. This budget is the
 * app's own bound, well inside that limit. Every stage and retry draws on it, starting when the
 * run does. Per-stage timeouts are caps inside it, not a sum.
 */
export const RUN_BUDGET_MS = 24_000
/** A stage is not started with less time than this left in the budget. */
export const MIN_STAGE_MS = 2_000

const MAX_CONTEXT_CHARS = 800

/** Trims context to keep generation fast. Shorter input means less waiting. */
export function trimCtx(text: string | undefined): string {
  const value = text?.trim() ?? ''
  if (!value) return '(no output from the previous agent)'
  return value.length > MAX_CONTEXT_CHARS ? `${value.slice(0, MAX_CONTEXT_CHARS)}\n[trimmed]` : value
}

const KEY_LINE_MAX = 140

/**
 * The first real line of a stage's output with markdown markers removed. It is the trace detail.
 * A long line is cut at the last word boundary before the limit and ends with an ellipsis.
 */
export function keyLine(text: string): string {
  const line = text
    .split('\n')
    .map(part => part.trim())
    .find(part => part.length > 0)
  const clean = (line ?? '').replace(/[*_`#>]/g, '').trim().replace(/^(?:[-•]|\d+\.)\s*/, '')
  if (clean.length <= KEY_LINE_MAX) return clean
  const head = clean.slice(0, KEY_LINE_MAX)
  const lastSpace = head.lastIndexOf(' ')
  return `${(lastSpace > KEY_LINE_MAX / 2 ? head.slice(0, lastSpace) : head).trimEnd()}…`
}

export const AGENTS: AgentConfig[] = [
  {
    role: 'researcher',
    name: 'Researcher',
    systemPrompt:
      'You are a research assistant. Give 3-5 bullet points with key facts. Use markdown. STRICT LIMIT: 150 words max. Do NOT write long paragraphs.',
    buildUserMessage: query => `Research: ${query}\n\n3-5 bullet points only. Be extremely concise.`,
    maxTokens: 600,
    timeoutMs: 5500,
  },
  {
    role: 'analyst',
    name: 'Analyst',
    systemPrompt:
      'You are an analyst. Identify 2-3 key patterns from the research. Markdown bullets. STRICT LIMIT: 150 words max.',
    buildUserMessage: (_query, ctx) => `Analyze:\n${trimCtx(ctx.researcher)}\n\n2-3 key patterns only. Extremely concise.`,
    maxTokens: 600,
    timeoutMs: 5500,
  },
  {
    role: 'critic',
    name: 'Critic',
    systemPrompt: 'You are a critic. Note 2-3 gaps or missing angles. Markdown bullets. STRICT LIMIT: 100 words max.',
    buildUserMessage: (_query, ctx) => `Review:\n${trimCtx(ctx.analyst)}\n\n2-3 gaps only. Very brief.`,
    maxTokens: 400,
    timeoutMs: 4500,
  },
  {
    role: 'synthesizer',
    name: 'Synthesizer',
    systemPrompt:
      'You are a synthesis agent. Combine research, analysis, and critique into a final report with clear markdown sections. If the question sets a length or format, such as "in two sentences" or "under 50 words", follow it exactly. Otherwise aim for 200-300 words.',
    buildUserMessage: (query, ctx) =>
      `Final report on "${query}".\n\nResearch:\n${trimCtx(ctx.researcher)}\n\nAnalysis:\n${trimCtx(ctx.analyst)}\n\nGaps:\n${trimCtx(ctx.critic)}`,
    maxTokens: 1200,
    timeoutMs: 10000,
  },
]
