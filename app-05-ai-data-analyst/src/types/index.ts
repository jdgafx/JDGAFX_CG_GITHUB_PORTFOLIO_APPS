export type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'scatter'

export type AggregateFn = 'sum' | 'avg' | 'count' | 'min' | 'max'

export type FilterOp = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains'

export type SortDir = 'asc' | 'desc'

/** Comparisons for a threshold on the aggregated value. */
export type HavingOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq'

/** One row test: the column, how to compare it, and the text to compare with. */
export interface PlanFilter {
  field: string
  op: FilterOp
  value: string
}

export interface QueryPlan {
  chartType: ChartType
  groupBy: string
  aggregate: {
    field: string
    fn: AggregateFn
  }
  filter?: PlanFilter
  /** Further row tests that must all hold together with `filter` ("only Alaska" after "magnitude over 4"). */
  moreFilters?: PlanFilter[]
  sortBy?: {
    field: string
    dir: SortDir
  }
  /**
   * A threshold on the aggregated value, applied after grouping ("months with at least 100 mm
   * of rain in total"). `filter` is for single rows before grouping; this is for whole groups.
   */
  having?: {
    op: HavingOp
    value: number
  }
  /** Keeps only the first N groups after the threshold and the sort ("the top 5"). */
  limit?: number
  title: string
  explanation: string
  /**
   * Set only on a follow-up the data cannot support. One plain sentence saying why. The plan is
   * then the previous plan unchanged, so there is nothing new to run.
   */
  cannotApply?: string
  /**
   * What the question names that the dataset does not have, such as "wind speed". Present only
   * when the list is non-empty. It is the one signal that the chart is a stand-in.
   */
  missing?: string[]
  /** A plain remark from the model. It never marks the chart as a stand-in on its own. */
  notice?: string
}

export type StepStatus = 'ok' | 'failed' | 'skipped'

/** One step of a run. ms is measured with Date.now(); tokens and cost only on model calls. */
export interface RunStep {
  name: string
  status: StepStatus
  ms: number
  detail: string
  tokens?: number
  cost?: number
}

export interface RunUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  /** USD, reported by the provider. Absent when it is not reported. */
  cost?: number
}

export interface RunSummary {
  trace: RunStep[]
  usage: RunUsage
  model: string | null
  totalMs: number
}

/** The body of a successful /api/ai response. */
export interface AnalysisResponse extends RunSummary {
  result: QueryPlan
}

export type RunOutcome = 'done' | 'failed' | 'stopped'

export interface RunView extends RunSummary {
  outcome: RunOutcome
}

export interface ParsedData {
  headers: string[]
  rows: Record<string, string>[]
  truncated?: boolean
  totalRows?: number
  parseErrorRowCount?: number
}

/** What the groups looked like before a `having` threshold removed some of them. */
export interface HavingStats {
  /** Groups before the threshold. */
  total: number
  highest: { label: string; value: number } | null
  lowest: { label: string; value: number } | null
}

/** The words the page uses for a dataset's columns and rows, so answers read "earthquakes", not "rows". */
export interface Vocabulary {
  /** What one row is, in the plural: "earthquakes", "days", "rows". */
  rowNoun: string
  /** Plain names for columns. A column without an entry keeps its own name. */
  labels: Record<string, string>
  /** Units shown after a value measured in that column. */
  units: Record<string, string>
}

export interface EngineResult {
  labels: string[]
  datasets: { name: string; values: number[] }[]
  warnings: string[]
  /** Set only when the plan has a `having` threshold. */
  having?: HavingStats
  /** Set only when the plan's `limit` cut groups off. `total` counts the groups before the cut. */
  limited?: { total: number; tiedBeyond: number }
}

/** The group a question points at. `tied` lists every group with the same value, the top one first. */
export interface TopGroup {
  label: string
  value: number
  tied: string[]
}

export interface AnalysisResult extends EngineResult {
  queryPlan: QueryPlan
  question: string
  dataset: string
  /** The dataset's own words. Absent means the raw column names. */
  vocab?: Vocabulary
}

/** What a follow-up changed in the plan, as one readable chip. */
export interface PlanChange {
  kind: 'filter' | 'group' | 'measure' | 'sort' | 'chart' | 'having' | 'limit' | 'none'
  /** How the plan moved: something added, replaced or taken away. */
  effect: 'added' | 'changed' | 'removed' | 'same'
  text: string
}

/**
 * One step of an analysis thread: a question, what it changed in the plan, the answer it
 * produced and the run that produced it. A follow-up the data cannot support keeps the
 * previous result and carries the reason.
 */
export interface ThreadStep {
  id: string
  question: string
  kind: 'ask' | 'follow-up'
  /** What changed against the step before it. Empty for the first question. */
  changes: PlanChange[]
  /** The step this one refined. Absent on the first question. */
  basedOn?: string
  /** Set when the follow-up could not be applied. The result is then the previous step's. */
  notApplied?: string
  result: AnalysisResult
  run: RunView
  timestamp: Date
}

export interface Thread {
  id: string
  dataset: string
  steps: ThreadStep[]
}

/** Where a dataset came from, shown beside it so a visitor can check the numbers at the source. */
export interface DataSourceInfo {
  kind: 'live' | 'upload'
  /** Who publishes the data, or "Your file" for an upload. */
  provider: string
  /** The dataset's title, or the file name for an upload. */
  label: string
  /** What the rows cover, in one line. */
  detail: string
  /** The exact request URL. Null for an upload. */
  url: string | null
  fetchedAt: Date
}

export interface LoadedDataset {
  data: ParsedData
  source: DataSourceInfo
  vocab?: Vocabulary
}

export interface DatasetOption {
  value: string
  label: string
}
