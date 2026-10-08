import { COMPARE_MAX_TOKENS, type PanelResult, type Slot, type TraceStep } from './contract'
import type { LiveModel } from './catalogue'
import { usageFrom, emptyUsage } from './measure'
import { chat, replyOf, type ChatMessage } from './openrouter'
import { strOrNull } from './parse'

export const PANEL_TIMEOUT_MS = 25_000

export interface PanelInput {
  key: string
  slot: Slot
  model: string
  prompt: string
  system?: string
  temperature?: number
  prices: Map<string, LiveModel> | null
}

export async function runPanel(input: PanelInput): Promise<PanelResult> {
  const messages: ChatMessage[] = input.system ? [{ role: 'system', content: input.system }] : []
  messages.push({ role: 'user', content: input.prompt })
  // Reasoning is left on here on purpose: the panels should show what the model really does.
  const result = await chat(
    input.key,
    {
      model: input.model,
      messages,
      max_tokens: COMPARE_MAX_TOKENS,
      temperature: input.temperature,
    },
    PANEL_TIMEOUT_MS,
  )
  const base = { slot: input.slot, requestedModel: input.model, latencyMs: result.latencyMs }
  if (!result.ok) {
    return { ...base, servedModel: null, ok: false, error: result.error, text: '', finishReason: null, usage: emptyUsage(), cost: null }
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
  return { ...base, servedModel: served, ok, error, text, finishReason, usage, cost }
}

export function panelStep(panel: PanelResult): TraceStep {
  const output =
    panel.usage.completion_tokens === null ? 'output tokens not reported' : `${panel.usage.completion_tokens} output tokens`
  return {
    name: `Panel ${panel.slot} request`,
    status: panel.ok ? 'ok' : 'failed',
    ms: panel.latencyMs,
    detail: panel.ok ? `Served by ${panel.servedModel ?? 'a model not reported'}, ${output}` : (panel.error ?? 'Failed'),
    tokens: panel.usage.total_tokens,
    cost: panel.cost,
  }
}

export function failedPanel(slot: Slot, model: string): PanelResult {
  return {
    slot,
    requestedModel: model,
    servedModel: null,
    ok: false,
    error: 'The panel stopped unexpectedly',
    text: '',
    finishReason: null,
    latencyMs: null,
    usage: emptyUsage(),
    cost: null,
  }
}
