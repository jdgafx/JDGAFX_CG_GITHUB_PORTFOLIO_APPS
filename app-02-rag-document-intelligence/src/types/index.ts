/** What the numbers in `DocumentState.chunkPages` count. */
export type LocationUnit = 'page' | 'section'

/** Where a document came from, shown under its title. `url` is null for a file the person chose. */
export interface DocumentSource {
  label: string
  url: string | null
}

export interface DocumentState {
  title: string
  source: DocumentSource
  chunks: string[]
  /** Page or section number each chunk starts on, parallel to `chunks`. */
  chunkPages: number[]
  unit: LocationUnit
  /** How many pages or sections the document has. */
  pages: number
  /** Section titles, where entry n is section n + 1. Empty when the unit is 'page'. */
  sectionTitles: string[]
  charCount: number
}

/** One step of a run. `ms` is null when the step was not timed (skipped, or failed before timing). */
export interface TraceStep {
  name: string
  status: 'ok' | 'failed' | 'skipped'
  ms: number | null
  detail: string
  tokens?: number | null
  cost?: number | null
}

export interface Usage {
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  cost: number | null
  cost_source: 'reported' | 'estimated' | null
}

/** What the run report shows about one question. Null fields render as "not reported". */
export interface RunReport {
  trace: TraceStep[]
  usage: Usage | null
  model: string | null
  totalMs: number | null
}

/** How the latest run ended. Drives the badge and which metrics are shown. */
export type RunState = 'answered' | 'no-matches' | 'failed' | 'stopped'

export interface LatestRun {
  report: RunReport
  state: RunState
}

export interface Turn {
  id: string
  question: string
  kind: 'answered' | 'no-matches'
  answer: string
  sourceChunks: number[]
  selfRated: number | null
  model: string | null
}
