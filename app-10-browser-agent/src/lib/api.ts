import type { BotStep, PageContentType, StepAction } from '../types'

const VALID_ACTIONS: StepAction[] = ['navigate', 'find', 'click', 'type', 'extract', 'verify']

const VALID_PAGE_CONTENT: PageContentType[] = [
  'flights-search', 'flights-results',
  'job-board', 'job-results',
  'ecommerce', 'ecommerce-results',
  'form', 'search-results', 'generic',
]

const MAX_ERROR_DETAIL = 300

const STATUS_COPY: Record<number, string> = {
  429: 'The agent service is handling too many requests right now. Wait a moment and try again.',
  502: 'The agent service is temporarily unavailable. Try again in a moment.',
  503: 'The agent service is temporarily unavailable. Try again in a moment.',
  504: 'The agent took too long to respond. Try again or pick a shorter task.',
}

/**
 * User-facing message for a failed response. Only a JSON {error} body — our own function's
 * curated copy — is ever shown; anything else (gateway HTML, raw upstream bodies) gets
 * status-mapped friendly copy instead.
 */
async function errorMessage(response: Response): Promise<string> {
  try {
    const parsed = JSON.parse(await response.text()) as { error?: unknown }
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      return parsed.error.trim().slice(0, MAX_ERROR_DETAIL)
    }
  } catch {
    // Non-JSON or unreadable body — never surface it raw.
  }
  return STATUS_COPY[response.status]
    ?? `The agent service returned an error (HTTP ${response.status}). Try again in a moment.`
}

function toStep(raw: unknown): BotStep | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (typeof s.action !== 'string' || !VALID_ACTIONS.includes(s.action as StepAction)) return null
  if (typeof s.target !== 'string' || typeof s.thought !== 'string') return null

  const pageContent = VALID_PAGE_CONTENT.includes(s.pageContent as PageContentType)
    ? (s.pageContent as PageContentType)
    : 'generic'

  return {
    action: s.action as StepAction,
    target: s.target,
    thought: s.thought,
    value: typeof s.value === 'string' ? s.value : undefined,
    url: typeof s.url === 'string' ? s.url : undefined,
    pageContent,
  }
}

export async function generateScenario(task: string): Promise<BotStep[]> {
  let response: Response
  try {
    response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task }),
    })
  } catch {
    // Transport failure ("Failed to fetch") — offline, DNS, CORS. Never show it raw.
    throw new Error('Could not reach the agent service. Check your connection and try again.')
  }

  if (!response.ok) {
    throw new Error(await errorMessage(response))
  }

  let data: { steps?: unknown }
  try {
    data = await response.json() as { steps?: unknown }
  } catch {
    throw new Error('The agent returned a response that was not valid JSON.')
  }

  if (!Array.isArray(data.steps)) throw new Error('The agent returned no step list.')

  const steps = data.steps.map(toStep).filter((s): s is BotStep => s !== null)

  if (steps.length === 0) throw new Error('The agent returned no usable steps for this task.')

  return steps
}
