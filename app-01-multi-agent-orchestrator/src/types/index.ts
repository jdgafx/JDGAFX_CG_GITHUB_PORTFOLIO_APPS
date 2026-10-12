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
  status: 'ok' | 'failed' | 'skipped'
  ms: number
  detail: string
  tokens?: number
  cost?: number
}

/** 'match': the served model is the newest Haiku. 'mismatch': it is not. 'unchecked': the list does not name the newest. 'not-reported': the reply named no model. */
export type ModelCheck = 'match' | 'mismatch' | 'unchecked' | 'not-reported'

/** The model facts of one model call. servedModel is null when the reply named none; it is never the requested alias. */
export interface ModelFacts {
  servedModel: string | null
  newestModel: string | null
  modelCheck: ModelCheck
}

export interface RunSummary {
  result: string
  trace: TraceStep[]
  usage: StageUsage
  /** The model of the Synthesizer, whose reply is the report shown. */
  model?: ModelFacts
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
  model?: ModelFacts
  /** One record per attempt of the stage. */
  calls?: ModelFacts[]
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
      model: ModelFacts
      /** One record per attempt of the stage; the reply's own record is `model`. */
      calls: ModelFacts[]
      usage: StageUsage
      /** Why the stage was tried a second time, when it was: 'timeout', 'connection' or 'reply'. */
      retried?: string
    }
  | { type: 'agent_skipped'; agent: ModelRole; detail: string }
  | { type: 'agent_error'; agent: AgentRole | 'system'; ms?: number; error: string; usage?: StageUsage }
  | ({ type: 'session_complete'; agent: 'synthesizer' } & RunSummary)

/** The audit's verdict on one cited claim. 'research' means the model typed the sentence as about the research itself, so no source is asked to back it. 'unverified' means the model said supported but the text it quoted is not in the source. 'unchecked' means no verdict was reached. Neither is hidden. 'checking' exists only in the browser, while the request is out. */
export type Verdict = 'supported' | 'partly' | 'unsupported' | 'unverified' | 'research' | 'unchecked' | 'checking'

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

/** A span the model quoted, found word for word in the source. start and end are offsets into the source snippet. */
export interface AuditQuote {
  n: number
  start: number
  end: number
  text: string
}

/** What the span check did with the spans the model quoted for one claim. `missed` counts spans not found and malformed entries; `joined` counts spans found only as separate passages. */
export interface SpanTrace {
  asked: Array<{ source: number; text: string }>
  found: number
  missed: number
  joined: number
  malformed: number
}

/** The model's four typed answers about one claim. */
export interface AuditAnswers {
  sourceSupports: 'yes' | 'no'
  subjectMatches: 'yes' | 'no'
  causeMatches: 'yes' | 'no' | 'not_applicable'
  allPartsCovered: 'yes' | 'no'
}

/** Everything the verdict was derived from, kept so a verifier can see why a claim got its verdict. */
export interface AuditJudged {
  kind: 'source_claim' | 'about_research'
  answers?: AuditAnswers
  spans: SpanTrace
}

/** One sentence of the report that carries [n] markers, with its verdict. block and piece say where it sits in the report. */
export interface AuditClaim {
  id: number
  block: number
  piece: number
  text: string
  cites: number[]
  /** Which text unit of the block holds the sentence: 0 for a paragraph, list item, quote or heading; the cell for a table; the line for code. */
  unit?: number
  pre: PreCheck
  verdict: Verdict
  reason: string
  /** Every span the model relied on that was found word for word in a cited source. */
  quotes?: AuditQuote[]
  /** For a partly supported or unsupported claim, the part of it the source does not cover, as the model said. */
  uncovered?: string
  /** How the verdict was reached. Absent when the model gave none. */
  judged?: AuditJudged
}

export interface AuditSummary {
  total: number
  supported: number
  partly: number
  unsupported: number
  unchecked: number
  unverified: number
  /** Sentences the model typed as about the research itself. */
  research: number
}

export interface AuditResult {
  claims: AuditClaim[]
  summary: AuditSummary
  /** Cited sentences past the audit's limit; they are listed as not checked. */
  overLimit: number
  /** The model of the audit's one judgment call. Absent when no sentence needed the model. */
  model?: ModelFacts
  /** One record per attempt of the judgment call. */
  calls?: ModelFacts[]
  usage: StageUsage
  ms: number
  /** Why the model call was tried a second time, when it was. */
  retried?: string
  /** One record per model call: which claims it judged, how it ended, and what it was billed. */
  callTrace?: AuditCallTrace[]
  /** How many calls reported no usage. When above 0, `usage` is what the other calls reported: at least that much was billed. */
  usageGaps?: number
}

export interface AuditCallTrace {
  claims: number[]
  /** The finish reason of the reply used, or 'rejected' when the call failed before a reply. */
  finish: string | null
  reasoningTokens: number
  usage: StageUsage
  retried?: string
}
