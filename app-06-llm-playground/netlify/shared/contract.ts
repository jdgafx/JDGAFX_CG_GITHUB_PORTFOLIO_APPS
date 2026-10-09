// Shapes shared by the three ModelArena endpoints and the client. Keep this file free of
// runtime imports: the browser bundle imports its constants and types from here.

export const MODEL = 'anthropic/claude-haiku-5.5'
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
  // Blind: the server shuffles the panels and withholds who answered what until a vote is cast.
  blind?: boolean
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
  // True when the first attempt timed out or lost its connection and a second one was made.
  retried?: boolean
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
  blind?: false
  // Set on a blind request that cannot take a vote: the reason, with the panels shown openly.
  notVoteable?: string
}

// ---- Blind arena -------------------------------------------------------------------------------

export const ELO_START = 1000
export const ELO_K = 24
// A blind run takes its vote within this long. After that the stored run is gone.
export const RUN_TTL_MS = 30 * 60_000
// Votes behind a rating: fewer than FEW_VOTES is "few votes", fewer than STEADY_VOTES is "provisional".
export const FEW_VOTES = 5
export const STEADY_VOTES = 20

// What a blind visitor sees of one panel: the text and nothing that names or fingerprints the model.
export interface BlindAnswer {
  label: Slot
  ok: boolean
  error: string | null
  text: string
  finishReason: string | null
}

export interface BlindCompareResponse {
  blind: true
  runId: string
  expiresAt: string
  totalMs: number
  answers: BlindAnswer[]
}

export type CompareResult = CompareResponse | BlindCompareResponse

// A run id is the expiry time in milliseconds, then a random UUID. The browser treats it as opaque.
export const RUN_ID_PATTERN = /^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type VoteChoice = Slot | 'tie' | 'all-bad'
export const VOTE_CHOICES: readonly VoteChoice[] = ['A', 'B', 'C', 'tie', 'all-bad']

export interface VoteRequest {
  runId: string
  choice: VoteChoice
}

export type Confidence = 'few' | 'provisional' | 'steady'

export interface LeaderboardRow {
  rank: number
  model: string
  rating: number
  wins: number
  losses: number
  ties: number
  votes: number
  lastServed: string | null
  confidence: Confidence
}

export interface LeaderboardResponse {
  rows: LeaderboardRow[]
  ballots: number
  ties: number
  allBad: number
  updatedAt: string | null
  // memory: Netlify Blobs is not configured here, so votes live in this server's memory only.
  storage: 'blobs' | 'memory'
}

export interface RatingChange {
  model: string
  before: number
  after: number
}

export interface VoteResponse {
  ok: true
  choice: VoteChoice
  // The run with its models revealed, relabelled to the labels the visitor saw.
  compare: CompareResponse
  changes: RatingChange[]
  leaderboard: LeaderboardResponse
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
