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

export type CostSource = 'usage' | 'estimated'

/** One finished node execution. Extract rows carry the chunk id, its model, usage and cost. */
export interface TraceRow {
  node: NodeName
  status: TraceStatus
  ms: number
  detail: string
  chunk?: number
  model?: string
  usage?: Usage
  cost?: number
  costSource?: CostSource
  /** Plain message for a failed row, shown to the user if the run cannot continue. */
  message?: string
}

export interface RunMetrics {
  totalMs: number
  totalTokens: number
  totalCost: number | null
  costSource: CostSource | null
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
