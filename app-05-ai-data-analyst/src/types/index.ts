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
  served_model?: string
  served_provider?: 'xAI' | 'Anthropic' | 'OpenRouter'
  execution?: {
    stages: Array<{ stage: 'accepted' | 'provider' | 'validation' | 'completed'; status: 'complete' }>
    durationMs: number
  }
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
}

export interface HistoryEntry {
  id: string
  question: string
  dataset: string
  result: AnalysisResult
  timestamp: Date
}

export interface DatasetMeta {
  value: string
  label: string
  description: string
  icon: string
}
