/** Types shared by the server pipeline and the browser UI. Types only, no runtime code. */

export type NodeName = 'split' | 'extract' | 'reduce' | 'synthesize' | 'check' | 'final'

export interface Usage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export interface Chunk {
  id: number
  text: string
}

/** One extraction result for one chunk. Findings are appended by a reducer. */
export interface Finding {
  chunkId: number
  points: string[]
  entities: string[]
  model: string | null
  usage: Usage | null
}

/** Output of the deterministic reduce step: one entry per chunk, plus unique entities. */
export interface Merged {
  byChunk: Array<{ chunkId: number; points: string[]; entities: string[] }>
  entities: string[]
  findingCount: number
}

export interface SummaryPoint {
  text: string
  chunks: number[]
}

export interface SummarySection {
  heading: string
  points: SummaryPoint[]
}

export interface Summary {
  overview: string
  sections: SummarySection[]
}

/**
 * covered and missing partition the chunk ids. A chunk is covered when it gave key points and the summary
 * cites it. noPoints lists the missing chunks that gave no key points, so the rest of missing are chunks
 * the summary does not cite.
 */
export interface Coverage {
  covered: number[]
  missing: number[]
  noPoints: number[]
}

export type TraceStatus = 'ok' | 'failed'

/** A model's price in USD per token, as OpenRouter lists it. */
export interface PriceRate {
  prompt: number
  completion: number
}

/**
 * How one answered call was priced. priced: its tokens times the served model's price on OpenRouter's public model
 * list. no-served-model: the reply named no model, so there is no price. unavailable: the list could not be read,
 * or does not carry the served model, or the reply's token counts were incomplete.
 */
export type PriceState = 'priced' | 'no-served-model' | 'unavailable'

/**
 * How the served model of one call compares with the newest model OpenRouter's list names for the alias. match and
 * mismatch compare two ids. not-reported: the reply named no model. unchecked: the list did not name a newest model.
 */
export type ModelCheck = 'match' | 'mismatch' | 'unchecked' | 'not-reported'

/** One finished node execution. Extract rows carry the chunk id, its model, usage and cost. */
export interface TraceRow {
  node: NodeName
  status: TraceStatus
  ms: number
  detail: string
  chunk?: number
  /** The model id the call requested. Never shown: the page shows servedModel. */
  model?: string
  /** The model OpenRouter answered with, or null when the reply named none. */
  servedModel?: string | null
  /** The newest model the list names for the alias, or null when the list does not name one. Set with modelCheck. */
  newestModel?: string | null
  /** The served model compared with newestModel. Set on every call that got a reply. */
  modelCheck?: ModelCheck
  usage?: Usage
  /** Set on every call that got a reply. Calls that failed before one arrived have none. */
  priceState?: PriceState
  /** USD, tokens times rate. Only when priceState is priced. */
  cost?: number
  /** The served model's OpenRouter price that cost was computed from. Only when priceState is priced. */
  rate?: PriceRate
  /** Plain message for a failed row, shown to the user if the run cannot continue. */
  message?: string
}

export interface RunMetrics {
  totalMs: number
  totalTokens: number
  /** Null unless every call that got a reply was priced. */
  totalCost: number | null
  /** Why there is no total: the first of unavailable, no-served-model that applies to a call. Null when there is a total or no call answered. */
  priceNote: Exclude<PriceState, 'priced'> | null
  cheapCost: number | null
  cheapCalls: number
  synthesisCost: number | null
}

/**
 * What happened to the coverage retry. none: no chunk needed one. used: it ran and its summary is the one returned.
 * kept-first: it ran but covered no more chunks, so the first-pass summary is returned. used-nothing-new: it ran to
 * the end but found nothing new, so no second summary was written and the first pass stands. skipped: it was skipped
 * for time, or it did not finish, and the first-pass summary is returned.
 */
export type RetryOutcome = 'none' | 'used' | 'used-nothing-new' | 'kept-first' | 'skipped'

/** The key points one chunk gave, after the reduce step merged them. Chunks that gave none are absent. */
export interface ChunkKeyPoints {
  chunk: number
  points: string[]
}

/** What the graph's final node produces. */
export interface Outcome {
  summary: Summary
  coverage: Coverage
  entities: string[]
  retries: number
  chunkCount: number
  findingCount: number
  /** What each chunk's extraction found, so the page can show the evidence behind a summary point. */
  keyPoints: ChunkKeyPoints[]
  /** Chunks the review model thinks the summary covers thinly. Advisory: it never changes coverage or starts a retry. */
  reviewFlags: number[]
  /** Set only when a retry pass did not finish: the first-pass summary is returned, with the reason. */
  notice: string | null
  retryOutcome: RetryOutcome
}

export interface RunResult extends Outcome {
  metrics: RunMetrics
}

/** Server-sent frames. The split's edge carries the chunk count. node_start.ms is the offset from run start; node_end.ms is the node's own duration. */
export type Frame =
  | { type: 'node_start'; node: NodeName; ms: number; detail: string; chunk?: number }
  | ({ type: 'node_end' } & TraceRow)
  | { type: 'edge'; from: NodeName; to: NodeName; label: string; count?: number }
  | { type: 'result'; result: RunResult }
  | { type: 'error'; message: string }
