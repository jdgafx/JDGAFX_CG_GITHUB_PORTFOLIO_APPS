export type StepId = 'research' | 'outline' | 'draft' | 'edit' | 'polish'

export const PIPELINE_STEPS: StepId[] = ['research', 'outline', 'draft', 'edit', 'polish']

export type PipelineContext = Partial<Record<StepId, string>>

const API_PATH = '/api/ai'
const ERROR_DETAIL_CHARS = 200

export interface StepEvent {
  type: 'step_start' | 'step_chunk' | 'step_complete' | 'error'
  step?: StepId
  content?: string
  truncated?: boolean
}

export interface PipelineCallbacks {
  onStepStart: (step: StepId) => void
  onStepChunk: (step: StepId, chunk: string) => void
  onStepComplete: (step: StepId, fullContent: string, truncated: boolean) => void
  onPipelineComplete: () => void
  onError: (step: StepId, error: string) => void
  onAbort: (step: StepId) => void
}

export interface PipelineOptions {
  signal: AbortSignal
  /** Resume from this step, reusing the supplied context for the earlier ones. */
  startAt?: StepId
  context?: PipelineContext
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

function friendlyHttpError(status: number): string {
  if (status === 429) return 'The service is busy right now. Please retry in a moment.'
  if (status >= 500) return 'The service is temporarily unavailable. Please retry.'
  return 'The request could not be completed. Please retry.'
}

interface StepOutcome {
  content: string
  truncated: boolean
}

async function runStep(
  topic: string,
  contentType: string,
  step: StepId,
  context: PipelineContext,
  callbacks: PipelineCallbacks,
  signal: AbortSignal,
): Promise<StepOutcome> {
  let response: Response
  try {
    response = await fetch(API_PATH, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, contentType, step, context }),
    })
  } catch (err) {
    if (isAbort(err)) throw err
    console.error(`${step} request failed:`, err)
    throw new Error('Lost connection. Check your network and retry.')
  }

  if (!response.ok) {
    let detail = `${response.status}`
    try {
      const text = await response.text()
      if (text) detail += ` - ${text.slice(0, ERROR_DETAIL_CHARS)}`
    } catch { /* body already consumed or unreadable */ }
    console.error(`${step} request failed: ${detail}`)
    throw new Error(friendlyHttpError(response.status))
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response stream')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let truncated = false
  let completed = false
  let serverError = ''

  const processLine = (line: string) => {
    if (!line.startsWith('data: ')) return
    const payload = line.slice(6).trim()
    if (!payload || payload === '[DONE]') return

    let event: StepEvent
    try {
      event = JSON.parse(payload) as StepEvent
    } catch {
      return
    }

    switch (event.type) {
      case 'step_start':
        if (event.step) callbacks.onStepStart(event.step)
        break
      case 'step_chunk':
        if (event.step && event.content) {
          content += event.content
          callbacks.onStepChunk(event.step, event.content)
        }
        break
      case 'step_complete':
        if (event.step) {
          completed = true
          // Server content is authoritative — it reconciles any dropped chunk.
          content = event.content ?? content
          truncated = event.truncated === true
        }
        break
      case 'error':
        serverError = event.content ?? 'Unknown error'
        break
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        processLine(line)
      }
    }

    if (buffer.trim()) processLine(buffer)
  } catch (err) {
    void reader.cancel().catch(() => { })
    throw err
  }

  if (serverError) {
    throw new Error(serverError)
  }

  // A stream that stops without step_complete was cut off (function timeout,
  // dropped connection). That is a failure, never a silent success.
  if (!completed) {
    throw new Error(`The ${step} step was cut off before it finished. Nothing was returned for it.`)
  }

  return { content, truncated }
}

export async function runPipeline(
  topic: string,
  contentType: string,
  callbacks: PipelineCallbacks,
  options: PipelineOptions,
): Promise<void> {
  const { signal } = options
  const context: PipelineContext = { ...options.context }
  const startIndex = options.startAt ? PIPELINE_STEPS.indexOf(options.startAt) : 0
  const steps = PIPELINE_STEPS.slice(startIndex < 0 ? 0 : startIndex)

  for (const step of steps) {
    if (signal.aborted) {
      callbacks.onAbort(step)
      return
    }

    try {
      const { content, truncated } = await runStep(topic, contentType, step, context, callbacks, signal)
      context[step] = content
      callbacks.onStepComplete(step, content, truncated)
    } catch (err) {
      if (isAbort(err) || signal.aborted) {
        callbacks.onAbort(step)
      } else {
        callbacks.onError(step, err instanceof Error ? err.message : 'Unexpected error')
      }
      return
    }
  }

  callbacks.onPipelineComplete()
}
