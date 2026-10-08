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
  /** Set by the model when the question names something the dataset does not have. */
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

export interface DatasetOption {
  value: string
  label: string
}
