export type StepId = 'research' | 'outline' | 'draft' | 'edit' | 'polish'

export interface StepEvent {
  type: 'step_start' | 'step_chunk' | 'step_complete' | 'pipeline_complete' | 'error'
  step?: StepId
  content?: string
}

export interface PipelineCallbacks {
  onStepStart: (step: StepId) => void
  onStepChunk: (step: StepId, chunk: string) => void
  onStepComplete: (step: StepId, fullContent: string) => void
  onPipelineComplete: () => void
  onError: (error: string) => void
}

export async function runPipeline(
  topic: string,
  contentType: string,
  callbacks: PipelineCallbacks
): Promise<void> {
  let response: Response
  try {
    response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, contentType }),
    })
  } catch (err) {
    callbacks.onError(`Network error: ${err instanceof Error ? err.message : 'Failed to connect'}`)
    return
  }

  if (!response.ok) {
    let detail = `${response.status}`
    try {
      const body = await response.text()
      if (body) detail += ` - ${body.slice(0, 200)}`
    } catch { /* ignore */ }
    callbacks.onError(`Request failed: ${detail}`)
    return
  }

  const reader = response.body?.getReader()
  if (!reader) {
    callbacks.onError('No response stream')
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let pipelineCompleted = false

  const processLine = (line: string) => {
    if (!line.startsWith('data: ')) return
    const payload = line.slice(6).trim()
    if (payload === '[DONE]') return

    try {
      const event = JSON.parse(payload) as StepEvent
      switch (event.type) {
        case 'step_start':
          if (event.step) callbacks.onStepStart(event.step)
          break
        case 'step_chunk':
          if (event.step && event.content) callbacks.onStepChunk(event.step, event.content)
          break
        case 'step_complete':
          if (event.step && event.content) callbacks.onStepComplete(event.step, event.content)
          break
        case 'pipeline_complete':
          pipelineCompleted = true
          callbacks.onPipelineComplete()
          break
        case 'error':
          callbacks.onError(event.content ?? 'Unknown error')
          break
      }
    } catch {
      // skip malformed JSON
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

    // Flush any remaining buffer content after stream ends
    if (buffer.trim()) {
      processLine(buffer)
    }
  } catch (err) {
    callbacks.onError(`Stream error: ${err instanceof Error ? err.message : 'Connection lost'}`)
    return
  }

  // Safety net: if stream ended without a pipeline_complete event, notify the UI
  if (!pipelineCompleted) {
    callbacks.onPipelineComplete()
  }
}
