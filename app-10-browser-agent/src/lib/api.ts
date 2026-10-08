import type { BotStep, PlanResponse, RunEvent, StepAction, TraceEntry, TraceStatus, UsageReport } from '../types'

const ACTIONS: StepAction[] = ['navigate', 'find', 'click', 'type', 'extract', 'verify']
const TRACE_STATUSES: TraceStatus[] = ['ok', 'failed', 'skipped']
const MAX_ERROR_CHARS = 300

const STATUS_COPY: Record<number, string> = {
  429: 'The planning service is handling too many requests right now. Wait a moment and try again.',
  502: 'The AI provider is unavailable right now. Try again in a moment.',
  503: 'The service is not available right now. Try again in a moment.',
  504: 'The agent took too long to respond. Try again or pick a shorter task.',
}

/** A failed request. `message` is curated copy. `trace` holds the stages measured before the failure. */
export class RequestFailure extends Error {
  readonly trace: TraceEntry[]

  constructor(message: string, trace: TraceEntry[] = []) {
    super(message)
    this.trace = trace
  }
}

function toTrace(raw: unknown): TraceEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): TraceEntry[] => {
    const entry = item as Partial<TraceEntry> | null
    if (!entry || typeof entry.name !== 'string' || !TRACE_STATUSES.includes(entry.status as TraceStatus)) return []
    return [{
      name: entry.name,
      status: entry.status as TraceStatus,
      ms: typeof entry.ms === 'number' ? entry.ms : 0,
      detail: typeof entry.detail === 'string' ? entry.detail : '',
      tokens: typeof entry.tokens === 'number' ? entry.tokens : undefined,
      cost: typeof entry.cost === 'number' ? entry.cost : undefined,
    }]
  })
}

function toUsage(raw: unknown): UsageReport {
  const source = (raw ?? {}) as Record<string, unknown>
  const figure = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  return {
    prompt_tokens: figure(source.prompt_tokens),
    completion_tokens: figure(source.completion_tokens),
    total_tokens: figure(source.total_tokens),
    cost: figure(source.cost),
  }
}

function toStep(raw: unknown): BotStep | null {
  if (!raw || typeof raw !== 'object') return null
  const step = raw as Record<string, unknown>
  if (typeof step.action !== 'string' || !ACTIONS.includes(step.action as StepAction)) return null
  if (typeof step.target !== 'string' || typeof step.thought !== 'string') return null
  return {
    action: step.action as StepAction,
    target: step.target,
    thought: step.thought,
    value: typeof step.value === 'string' ? step.value : undefined,
    url: typeof step.url === 'string' ? step.url : undefined,
  }
}

const isStep = (step: BotStep | null): step is BotStep => step !== null

interface ErrorBody {
  error?: unknown
  trace?: unknown
}

/** Shows only the server's own curated error text. Anything else gets plain status copy. */
async function readFailure(response: Response): Promise<RequestFailure> {
  let body: ErrorBody | null = null
  try {
    body = JSON.parse(await response.text()) as ErrorBody | null
  } catch {
    // Not JSON, such as a gateway page. Never show it raw.
  }
  const error = typeof body?.error === 'string' ? body.error.trim().slice(0, MAX_ERROR_CHARS) : ''
  const message = error || STATUS_COPY[response.status] || `The request failed with HTTP ${response.status}. Try again in a moment.`
  return new RequestFailure(message, toTrace(body?.trace))
}

export async function planTask(task: string, signal: AbortSignal): Promise<PlanResponse> {
  let response: Response
  try {
    response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task }),
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new RequestFailure('Could not reach the planning service. Check your connection and try again.')
  }
  if (!response.ok) throw await readFailure(response)

  let data: { result?: { steps?: unknown }; trace?: unknown; usage?: unknown; model?: unknown; totalMs?: unknown }
  try {
    data = await response.json()
  } catch {
    throw new RequestFailure('The agent returned a response that was not valid JSON.')
  }

  const rawSteps = data.result?.steps
  const steps = Array.isArray(rawSteps) ? rawSteps.map(toStep).filter(isStep) : []
  if (steps.length === 0) throw new RequestFailure('The agent returned no usable steps for this task.')

  return {
    result: { steps },
    trace: toTrace(data.trace),
    usage: toUsage(data.usage),
    model: typeof data.model === 'string' ? data.model : null,
    totalMs: typeof data.totalMs === 'number' ? data.totalMs : 0,
  }
}

/** Runs the plan and calls onEvent for each server event, in order, until the stream ends. */
export async function streamRun(steps: BotStep[], onEvent: (event: RunEvent) => void, signal: AbortSignal): Promise<void> {
  const response = await fetch('/api/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ steps }),
    signal,
  })
  if (!response.ok || !response.body) throw await readFailure(response)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const records = buffer.split('\n\n')
    buffer = records.pop() ?? ''
    for (const record of records) {
      const line = record.split('\n').find((item) => item.startsWith('data: '))
      if (line) onEvent(JSON.parse(line.slice(6)) as RunEvent)
    }
    if (done) break
  }
}
