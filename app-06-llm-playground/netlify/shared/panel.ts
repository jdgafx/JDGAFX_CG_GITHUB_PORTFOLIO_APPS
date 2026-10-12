import { COMPARE_MAX_TOKENS, type PanelResult, type Slot, type TraceStep } from './contract'
import type { LiveModel } from './catalogue'
import { usageFrom, emptyUsage } from './measure'
import { replyOf, type ChatMessage } from './openrouter'
import { ATTEMPT_MS, ATTEMPT_OTHER_MS, chatWithRetry } from './retry'
import { strOrNull } from './parse'
import { checkRecord, NOT_CHECKED } from './newest-model'

export const PANEL_TIMEOUT_MS = 25_000

interface PanelInput {
  key: string
  slot: Slot
  model: string
  prompt: string
  system?: string
  temperature?: number
  prices: Map<string, LiveModel> | null
  timeoutMs: number
  signal?: AbortSignal
  // Panel A only: the newest model the list names for the alias, started before the panels ran.
  newest?: Promise<string | null>
}

export async function runPanel(input: PanelInput): Promise<PanelResult> {
  const messages: ChatMessage[] = input.system ? [{ role: 'system', content: input.system }] : []
  messages.push({ role: 'user', content: input.prompt })
  // Reasoning is left on here on purpose: the panels should show what the model really does.
  const result = await chatWithRetry(
    input.key,
    {
      model: input.model,
      messages,
      max_tokens: COMPARE_MAX_TOKENS,
      temperature: input.temperature,
    },
    { budgetMs: input.timeoutMs, attemptMs: input.slot === 'A' ? ATTEMPT_MS : ATTEMPT_OTHER_MS, signal: input.signal },
  )
  const base = { slot: input.slot, requestedModel: input.model, latencyMs: result.latencyMs }
  if (!result.ok) {
    return { ...failed(input.slot, input.model, result.error, result.latencyMs), retried: result.retried, notReported: result.lost }
  }
  const served = strOrNull(result.data.model)
  const { text, finishReason } = replyOf(result.data)
  const { usage, cost } = usageFrom(result.data, served, input.prices)
  const ok = text.trim() !== ''
  const error = ok
    ? null
    : finishReason === 'length'
      ? `Hit the ${COMPARE_MAX_TOKENS}-token limit before any answer text`
      : 'The model returned no text'
  // Panel A's reply is checked against the newest model. Visitor-picked panels B and C are not.
  const record = input.newest ? checkRecord(await input.newest, served, input.model) : NOT_CHECKED
  // A try that was lost counts, and so does a reply that carried no usage at all.
  const notReported = result.lost + (usage.total_tokens === null && cost === null ? 1 : 0)
  return { ...base, servedModel: served, ok, error, text, finishReason, usage, cost, retried: result.retried, notReported, ...record }
}

export function panelStep(panel: PanelResult): TraceStep {
  const lost = panel.notReported ?? 0
  const output =
    panel.usage.completion_tokens === null ? 'output tokens not reported' : `${panel.usage.completion_tokens} output tokens`
  return {
    name: `Panel ${panel.slot} request`,
    status: panel.ok ? 'ok' : 'failed',
    ms: panel.latencyMs,
    detail:
      (panel.ok ? `Served by ${panel.servedModel ?? 'a model not reported'}, ${output}` : (panel.error ?? 'Failed')) +
      (panel.retried ? '. Retried once after the first try timed out' : '') +
      (lost > 0 ? `. Usage not reported for ${lost} ${lost === 1 ? 'call' : 'calls'}` : ''),
    tokens: panel.usage.total_tokens,
    cost: panel.cost,
  }
}

function failed(slot: Slot, model: string, error: string, latencyMs: number | null): PanelResult {
  return {
    slot,
    requestedModel: model,
    servedModel: null,
    ok: false,
    error,
    text: '',
    finishReason: null,
    latencyMs,
    usage: emptyUsage(),
    cost: null,
    ...NOT_CHECKED,
  }
}

export function failedPanel(slot: Slot, model: string): PanelResult {
  // The panel threw, so whether its call was billed is unknown.
  return { ...failed(slot, model, 'The panel stopped unexpectedly', null), notReported: 1 }
}
