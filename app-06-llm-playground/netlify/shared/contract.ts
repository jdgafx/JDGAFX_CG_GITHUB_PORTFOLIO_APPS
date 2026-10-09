// Shapes shared by the three ModelArena endpoints and the client. Keep this file free of
// runtime imports: the browser bundle imports its constants and types from here.

export const MODEL = '~anthropic/claude-haiku-latest'
export const PROMPT_MAX_CHARS = 4000
export const SYSTEM_MAX_CHARS = 2000
// Judge input: one answer at most ANSWER_MAX_CHARS, and all answers together at most
// JUDGE_TOTAL_MAX_CHARS. Longer input is refused, not cut.
export const ANSWER_MAX_CHARS = 8000
export const JUDGE_TOTAL_MAX_CHARS = 20000
export const COMPARE_MAX_TOKENS = 2048
export const JUDGE_MAX_TOKENS = 1024

export const SLOTS = ['A', 'B', 'C'] as const
export type Slot = (typeof SLOTS)[number]

// A model ID the server will consider is at most this many characters.
export const MODEL_ID_MAX_CHARS = 200

// Largest JSON body each POST endpoint reads. A character can take 6 bytes in JSON (a \u escape),
// so the limit is 6 bytes per character plus room for keys and model IDs. Every body within the
// character limits fits.
export const COMPARE_BODY_MAX_BYTES = (PROMPT_MAX_CHARS + SYSTEM_MAX_CHARS) * 6 + 4_096
export const JUDGE_BODY_MAX_BYTES = (PROMPT_MAX_CHARS + JUDGE_TOTAL_MAX_CHARS) * 6 + 4_096

export interface ModelOption {
  id: string
  label: string
  why: string
  inPerM: number | null
  outPerM: number | null
  contextLength: number | null
}

export interface ModelGroup {
  label: string
  options: ModelOption[]
}

export interface CatalogueResponse {
  // cached: the last good copy, served while refreshes fail after its TTL.
  source: 'live' | 'cached' | 'fallback'
  fetchedAt: string | null
  defaultModel: string
  groups: ModelGroup[]
}

export interface CompareRequest {
  prompt: string
  models: [string, string, string]
  system?: string
  temperature?: number
}

export interface Usage {
  prompt_tokens: number | null
  completion_tokens: number | null
  reasoning_tokens: number | null
  total_tokens: number | null
}

export interface Cost {
  usd: number
  source: 'usage' | 'estimated'
}

// One measured step of a run. The server measures ms and tokens; the browser adds "running".
export interface TraceStep {
  name: string
  status: 'ok' | 'failed' | 'skipped'
  ms: number | null
  detail: string
  tokens: number | null
  cost: Cost | null
}

export interface PanelResult {
  slot: Slot
  requestedModel: string
  servedModel: string | null
  ok: boolean
  error: string | null
  text: string
  finishReason: string | null
  latencyMs: number | null
  usage: Usage
  cost: Cost | null
}

export interface CompareSummary {
  fastest: { slot: Slot; model: string; latencyMs: number } | null
  cheapest: { slot: Slot; model: string; usd: number; source: Cost['source'] } | null
  mostOutputTokens: { slot: Slot; model: string; tokens: number } | null
  measuredAt: string
}

export interface CompareResponse {
  runId: string
  totalMs: number
  panels: PanelResult[]
  trace: TraceStep[]
  summary: CompareSummary
}

export interface JudgeRequest {
  prompt: string
  answers: { slot: Slot; text: string }[]
}

export interface JudgeVerdict {
  ok: true
  model: string | null
  latencyMs: number
  bestOverall: Slot | 'tie'
  perPanel: Partial<Record<Slot, string>>
  caveat: string
  usage: Usage
  cost: Cost | null
  trace: TraceStep[]
}

interface JudgeFailure {
  ok: false
  reason: string
  model: string | null
  latencyMs: number
  trace: TraceStep[]
}

export type JudgeResponse = JudgeVerdict | JudgeFailure
