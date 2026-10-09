export type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'scatter'

export type AggregateFn = 'sum' | 'avg' | 'count' | 'min' | 'max'

export type FilterOp = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains'

export type SortDir = 'asc' | 'desc'

export interface QueryPlan {
  chartType: ChartType
  groupBy: string
  aggregate: {
    field: string
    fn: AggregateFn
  }
  filter?: {
    field: string
    op: FilterOp
    value: string
  }
  sortBy?: {
    field: string
    dir: SortDir
  }
  title: string
  explanation: string
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

export interface EngineResult {
  labels: string[]
  datasets: { name: string; values: number[] }[]
  warnings: string[]
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
}

export interface HistoryEntry {
  id: string
  result: AnalysisResult
  run: RunView
  timestamp: Date
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
}

export interface DatasetOption {
  value: string
  label: string
}
