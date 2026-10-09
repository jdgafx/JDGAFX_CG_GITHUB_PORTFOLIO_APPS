/** The four stages that call the model, in pipeline order. */
export type ModelRole = 'researcher' | 'analyst' | 'critic' | 'synthesizer'

/** Every step of a run. The retriever fetches public sources and makes no model call. */
export type AgentRole = 'retriever' | ModelRole

/** 'stopped' is set in the browser when the visitor ends the run during this stage. */
export type AgentStatus = 'idle' | 'working' | 'complete' | 'error' | 'skipped' | 'stopped'

/** Usage as the provider reports it. A missing field means the provider did not report it. */
export interface StageUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  /** USD, from usage.cost in the provider response. */
  cost?: number
}

/** One retrieved public source. `n` is the number the Researcher cites as [n]. */
export interface Source {
  n: number
  title: string
  site: 'Wikipedia' | 'Hacker News'
  /** A link the server built itself from validated ids, always https. */
  url: string
  /** The capped text the Researcher was given, shown to the visitor as it was sent. */
  snippet: string
  /** A short line such as "764 points, 526 comments, Jan 2023". */
  note?: string
}

export interface TraceStep {
  name: string
  status: 'ok' | 'cut off' | 'failed' | 'skipped'
  ms: number
  detail: string
  tokens?: number
  cost?: number
}

export interface RunSummary {
  result: string
  trace: TraceStep[]
  usage: StageUsage
  model?: string
  totalMs: number
}

export interface AgentState {
  id: AgentRole
  name: string
  description: string
  status: AgentStatus
  output: string
  maxTokens: number
  /** One line for the trace: the key output, or why the stage did not finish. */
  detail: string
  error?: string
  ms?: number
  finish: string | null
  reasoningTokens: number
  usage?: StageUsage
  servedModel?: string
  /** Why this stage was tried a second time, when it was. */
  retried?: string
  /** Set on the retriever only: what it found. An empty list means it found nothing. */
  sources?: Source[]
}

/** Every event the server streams. Both sides import this type, so keep it the only copy. */
export type StreamEvent =
  | { type: 'retrieve_start' }
  | { type: 'retrieve_complete'; ms: number; sources: Source[]; detail: string }
  | { type: 'agent_start'; agent: ModelRole; maxTokens: number }
  | { type: 'agent_chunk'; agent: ModelRole; content: string }
  | {
      type: 'agent_complete'
      agent: ModelRole
      ms: number
      detail: string
      finish: string | null
      reasoningTokens: number
      servedModel?: string
      usage: StageUsage
      /** Why the stage was tried a second time, when it was: 'timeout', 'connection' or 'reply'. */
      retried?: string
    }
  | { type: 'agent_skipped'; agent: ModelRole; detail: string }
  | { type: 'agent_error'; agent: ModelRole | 'system'; ms?: number; error: string }
  | ({ type: 'session_complete'; agent: 'synthesizer' } & RunSummary)

/** The audit's verdict on one cited claim. 'unchecked' means no verdict was reached; it is never hidden. 'checking' exists only in the browser, while the request is out. */
export type Verdict = 'supported' | 'partly' | 'unsupported' | 'unchecked' | 'checking'

/** The deterministic pre-pass for one claim, computed against the text of the sources it cites. */
export interface PreCheck {
  /** Share of the claim's content words found in the cited source text, 0 to 1. */
  overlap: number
  /** The cited source that shares the most content words, or null when the claim cites none that exist. */
  best: number | null
  /** Numbers in the claim that appear in none of the cited sources. */
  missingNumbers: string[]
  /** Capitalised names in the claim that appear in none of the cited sources. */
  missingNames: string[]
  level: 'ok' | 'weak' | 'fail'
}

/** A quote the model gave, found word for word in the source. start and end are offsets into the source snippet. */
export interface AuditQuote {
  n: number
  start: number
  end: number
  text: string
}

/** One sentence of the report that carries [n] markers, with its verdict. block and piece say where it sits in the report. */
export interface AuditClaim {
  id: number
  block: number
  piece: number
  text: string
  cites: number[]
  pre: PreCheck
  verdict: Verdict
  reason: string
  quote?: AuditQuote
}

export interface AuditSummary {
  total: number
  supported: number
  partly: number
  unsupported: number
  unchecked: number
}

export interface AuditResult {
  claims: AuditClaim[]
  summary: AuditSummary
  /** Cited sentences past the audit's limit; they are listed as not checked. */
  overLimit: number
  model?: string
  usage: StageUsage
  ms: number
  /** Why the model call was tried a second time, when it was. */
  retried?: string
}
