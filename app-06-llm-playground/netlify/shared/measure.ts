import type { CompareSummary, Cost, PanelResult, Usage } from './contract'
import type { LiveModel } from './catalogue'
import { isRecord, numOrNull } from './parse'

export function emptyUsage(): Usage {
  return { prompt_tokens: null, completion_tokens: null, reasoning_tokens: null, total_tokens: null }
}

export function usageOf(raw: unknown): Usage {
  if (!isRecord(raw)) return emptyUsage()
  const details: Record<string, unknown> = isRecord(raw.completion_tokens_details) ? raw.completion_tokens_details : {}
  return {
    prompt_tokens: numOrNull(raw.prompt_tokens),
    completion_tokens: numOrNull(raw.completion_tokens),
    reasoning_tokens: numOrNull(details.reasoning_tokens),
    total_tokens: numOrNull(raw.total_tokens),
  }
}

// The billed cost wins. Without it, estimate from the catalogue price of the model that
// actually served the request. Stay null when either side is unknown: never invent a number.
export function costOf(
  usage: Usage,
  reported: unknown,
  served: string | null,
  prices: Map<string, LiveModel> | null,
): Cost | null {
  const billed = numOrNull(reported)
  if (billed !== null) return { usd: billed, source: 'usage' }
  const price = served && prices ? prices.get(served) : undefined
  if (!price || price.promptPerTok === null || price.completionPerTok === null) return null
  if (usage.prompt_tokens === null || usage.completion_tokens === null) return null
  return {
    usd: usage.prompt_tokens * price.promptPerTok + usage.completion_tokens * price.completionPerTok,
    source: 'estimated',
  }
}

export function usageFrom(
  data: Record<string, unknown>,
  served: string | null,
  prices: Map<string, LiveModel> | null,
): { usage: Usage; cost: Cost | null } {
  const raw: Record<string, unknown> = isRecord(data.usage) ? data.usage : {}
  const usage = usageOf(raw)
  return { usage, cost: costOf(usage, raw.cost, served, prices) }
}

type Timed = PanelResult & { latencyMs: number }

function isTimed(panel: PanelResult): panel is Timed {
  return panel.latencyMs !== null
}

function pick<T>(items: T[], score: (item: T) => number, better: (a: number, b: number) => boolean): T | null {
  let best: T | null = null
  for (const item of items) {
    if (best === null || better(score(item), score(best))) best = item
  }
  return best
}

// Winners come only from measured numbers. Ties go to the earlier panel.
export function summarise(panels: PanelResult[]): CompareSummary {
  const ok = panels.filter(p => p.ok)
  const fastest = pick(ok.filter(isTimed), p => p.latencyMs, (a, b) => a < b)
  const cheapest = pick(ok.filter(p => p.cost !== null), p => p.cost?.usd ?? 0, (a, b) => a < b)
  const cheapCost = cheapest?.cost ?? null
  const mostTokens = pick(ok.filter(p => p.usage.completion_tokens !== null), p => p.usage.completion_tokens ?? 0, (a, b) => a > b)
  const tokens = mostTokens?.usage.completion_tokens ?? null
  return {
    fastest: fastest ? { slot: fastest.slot, model: modelOf(fastest), latencyMs: fastest.latencyMs } : null,
    cheapest: cheapest && cheapCost ? { slot: cheapest.slot, model: modelOf(cheapest), usd: cheapCost.usd, source: cheapCost.source } : null,
    mostOutputTokens: mostTokens && tokens !== null ? { slot: mostTokens.slot, model: modelOf(mostTokens), tokens } : null,
    measuredAt: new Date().toISOString(),
  }
}

function modelOf(panel: PanelResult): string {
  return panel.servedModel ?? panel.requestedModel
}
