import type { BotStep, PageContentType, StepAction } from '../types'

const VALID_ACTIONS: StepAction[] = ['navigate', 'find', 'click', 'type', 'extract', 'verify']

const VALID_PAGE_CONTENT: PageContentType[] = [
  'flights-search', 'flights-results',
  'job-board', 'job-results',
  'ecommerce', 'ecommerce-results',
  'form', 'search-results', 'generic',
]

const MAX_ERROR_DETAIL = 300

/** Pull the server's own explanation out of a failed response so the UI can show it. */
async function errorMessage(response: Response): Promise<string> {
  let detail = ''
  try {
    const body = await response.text()
    if (body) {
      try {
        const parsed = JSON.parse(body) as { error?: unknown }
        detail = typeof parsed.error === 'string' ? parsed.error : body
      } catch {
        detail = body
      }
    }
  } catch {
    // Body unreadable — the status code below is all we can report.
  }
  detail = detail.trim().slice(0, MAX_ERROR_DETAIL)
  return detail ? `${detail} (HTTP ${response.status})` : `Request failed with HTTP ${response.status}`
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
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task }),
  })

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
