export interface ModelConfig {
  id: string
  name: string
  label: string
  shortName: string
  color: string
}

export interface ModelResult {
  text: string
  latencyMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  cost: number | null
  /** True when cost came from PRICING rather than the provider's usage report. */
  costEstimated: boolean
  /** Model id the provider actually served, resolved from the ~latest alias. */
  servedModel: string | null
  streaming: boolean
  done: boolean
  /** Server hit its time budget before the model finished. */
  truncated: boolean
  /** Provider reported finish_reason "length" -- the model hit Max Tokens, distinct from a time-budget cutoff. */
  capped: boolean
  /** User pressed Stop before the model finished. */
  cancelled: boolean
  error: string | null
  startTime: number | null
}

export const MODELS: ModelConfig[] = [
  {
    id: 'claude-haiku-4.5',
    name: 'claude-haiku-4.5',
    label: 'Claude Haiku (Latest)',
    shortName: 'Haiku',
    color: '#f59e0b',
  },
  {
    id: 'claude-sonnet-4.6',
    name: 'claude-sonnet-4.6',
    label: 'Claude Sonnet (Latest)',
    shortName: 'Sonnet',
    color: '#3b82f6',
  },
  {
    id: 'claude-opus',
    name: 'claude-opus',
    label: 'Claude Opus (Latest)',
    shortName: 'Opus',
    color: '#8b5cf6',
  },
]

/**
 * Fallback USD price per 1k tokens, used only when the provider does not report
 * an authoritative cost. These tiers track ~latest aliases, so a provider price
 * change lands here before it lands in the alias -- estimates are marked in the
 * UI with a leading tilde.
 */
export const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4.5': { input: 0.001, output: 0.005 },
  'claude-sonnet-4.6': { input: 0.003, output: 0.015 },
  'claude-opus': { input: 0.015, output: 0.075 },
}

export function estimateCost(
  modelId: string,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  const price = PRICING[modelId]
  // With no token counts there is nothing to estimate from -- a $0.00000
  // estimate would read as a real measurement.
  if (!price || (inputTokens === null && outputTokens === null)) return null
  return ((inputTokens ?? 0) / 1000) * price.input + ((outputTokens ?? 0) / 1000) * price.output
}

export function createEmptyResult(): ModelResult {
  return {
    text: '',
    latencyMs: null,
    inputTokens: null,
    outputTokens: null,
    cost: null,
    costEstimated: false,
    servedModel: null,
    streaming: false,
    done: false,
    truncated: false,
    capped: false,
    cancelled: false,
    error: null,
    startTime: null,
  }
}

export function statusLabel(result: ModelResult): string | null {
  if (result.error) return 'Failed'
  if (result.cancelled) return 'Stopped'
  if (result.truncated) return 'Truncated'
  if (result.capped) return 'Capped'
  if (result.streaming) return 'Streaming'
  if (result.done) return 'Complete'
  return null
}

/** Placeholder shown in a metric cell when the run produced no real number. */
export function metricFallback(result: ModelResult): string {
  if (result.cancelled) return 'Stopped'
  if (result.error) return 'n/a'
  if (result.truncated) return 'Unreported'
  return '—'
}
