import { ACTIONS, type BotStep, type UsageReport } from '../types'

const ACTION_LABEL: Record<BotStep['action'], string> = {
  navigate: 'Navigate',
  find: 'Find',
  click: 'Click',
  type: 'Type',
  extract: 'Extract',
  verify: 'Verify',
}

/** The row name for a step, such as "Navigate: Google home page". The page and the functions use the same format. */
export function stepLabel(step: BotStep): string {
  return `${ACTION_LABEL[step.action]}: ${step.target}`
}

export function isAction(value: unknown): value is BotStep['action'] {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value)
}

function figure(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** The four provider figures from a usage object. A figure that is missing or not a finite number is null. */
export function usageOf(raw: unknown): UsageReport {
  const source = (raw ?? {}) as Record<string, unknown>
  return {
    prompt_tokens: figure(source.prompt_tokens),
    completion_tokens: figure(source.completion_tokens),
    total_tokens: figure(source.total_tokens),
    cost: figure(source.cost),
  }
}
