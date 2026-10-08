import type { BotStep, StepAction } from '../../src/types'
import { isAllowedHost } from './domains'

export const MAX_STEPS = 10

const ACTIONS: StepAction[] = ['navigate', 'find', 'click', 'type', 'extract', 'verify']
const LIMITS = { target: 200, thought: 400, value: 500, url: 2048 }

/** A rejection with curated copy the browser may show verbatim. */
export class StepError extends Error {}

function readText(step: Record<string, unknown>, field: keyof typeof LIMITS, index: number): string | undefined {
  const value = step[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new StepError(`Step ${index + 1} has a ${field} that is not text.`)
  if (value.length > LIMITS[field]) throw new StepError(`Step ${index + 1} has a ${field} longer than ${LIMITS[field]} characters.`)
  return value
}

function parseAddress(raw: string, index: number): URL {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    throw new StepError(`Step ${index + 1} has an address that is not a valid URL.`)
  }
}

/** Turns a planned address into an absolute http(s) URL on an allowed host, or throws. */
function allowedUrl(raw: string, index: number, domains: string[]): string {
  const url = parseAddress(raw, index)
  if (!isAllowedHost(url.hostname, domains)) {
    throw new StepError(`Step ${index + 1} opens ${url.hostname}, which is outside the allowed sites: ${domains.join(', ')}.`)
  }
  url.username = ''
  url.password = ''
  return url.toString()
}

/**
 * Checks a plan's shape and addresses before any billable call. Throws StepError with curated
 * copy for the first problem found.
 */
export function validateSteps(raw: unknown, domains: string[]): BotStep[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_STEPS) {
    throw new StepError(`A plan needs 1 to ${MAX_STEPS} steps.`)
  }
  return raw.map((item, index): BotStep => {
    const step = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const action = step.action
    if (typeof action !== 'string' || !ACTIONS.includes(action as StepAction)) {
      throw new StepError(`Step ${index + 1} has an action the browser does not support.`)
    }
    const target = readText(step, 'target', index)
    if (target === undefined || !target.trim()) throw new StepError(`Step ${index + 1} has no target.`)
    const thought = readText(step, 'thought', index) ?? ''
    if (action === 'navigate') {
      return { action, target, thought, url: allowedUrl(readText(step, 'url', index) ?? target, index, domains) }
    }
    return { action: action as StepAction, target, thought, value: readText(step, 'value', index) }
  })
}
