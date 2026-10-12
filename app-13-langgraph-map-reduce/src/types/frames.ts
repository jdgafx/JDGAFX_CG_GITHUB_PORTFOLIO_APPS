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

/** One extracted key point. The id is "chunk.n" (1.2 is the second point of chunk 1). Code assigns it in the reduce step, never the model. */
export interface KeyPoint {
  id: string
  text: string
}

/** Output of the deterministic reduce step: one entry per chunk, plus unique entities. */
export interface Merged {
  byChunk: Array<{ chunkId: number; points: KeyPoint[]; entities: string[] }>
  entities: string[]
  findingCount: number
}

/** One summary sentence. points are the key point ids it states, as the model cited them and code validated them. chunks are those points' chunks, derived by code. */
export interface SummaryPoint {
  text: string
  points: string[]
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
 * The headline is per key point: citedPoints and uncitedPoints partition every extracted point id, and a point is used
 * only when the check finds a summary sentence that states it (one attribution call per chunk, after the writer).
 * covered and missing are the secondary, per chunk view: they partition the chunk ids, and a chunk is covered when it gave
 * key points and the writer cites it. noPoints lists the missing chunks that gave no key points, so the rest of missing
 * are chunks the writer does not cite at all.
 */
export interface Coverage {
  covered: number[]
  missing: number[]
  noPoints: number[]
  citedPoints: string[]
  uncitedPoints: string[]
  /** Chunks whose key points could not be checked against the summary (their attribution call failed). Their points are in uncitedPoints, because nothing showed they are used. */
  unchecked: number[]
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
  /** Calls that were made but whose reply never arrived (a timeout, a dropped connection, an abort), so their usage is not known. The totals leave them out and say so. */
  unreportedCalls: number
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
  points: KeyPoint[]
}

/**
 * What became of the review of the key points the summary does not use. done: the review answered. not-needed: the
 * summary uses every point, so there was nothing to review. skipped: too little of the run budget was left. unavailable:
 * the review call failed, was cut off, or answered in a form that could not be read.
 */
export type ReviewState = 'done' | 'not-needed' | 'skipped' | 'unavailable'

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
  /** Ids of unused key points the review model thinks matter to the document's main subject. Advisory: it never changes the summary, coverage or the retry. */
  reviewFlags: string[]
  review: ReviewState
  /** Set only when a retry pass did not finish: the first-pass summary is returned, with the reason. */
  notice: string | null
  retryOutcome: RetryOutcome
}

export interface RunResult extends Outcome {
  metrics: RunMetrics
}

/** The merged key points and a hash of the text they came from (a JSON string), and the server's seal over that string. */
export interface Handoff {
  text: string
  seal: string
}

/**
 * Server-sent frames. The split's edge carries the chunk count. node_start.ms is the offset from run start; node_end.ms is the node's own duration.
 * Request 1 ends with a handoff frame instead of a result: the merged key points, signed by the server, which the browser posts
 * back to request 2 unread. The page never sees it.
 */
export type Frame =
  | { type: 'node_start'; node: NodeName; ms: number; detail: string; chunk?: number }
  | ({ type: 'node_end' } & TraceRow)
  | { type: 'edge'; from: NodeName; to: NodeName; label: string; count?: number }
  | { type: 'handoff'; handoff: Handoff }
  | { type: 'result'; result: RunResult }
  | { type: 'error'; message: string }
