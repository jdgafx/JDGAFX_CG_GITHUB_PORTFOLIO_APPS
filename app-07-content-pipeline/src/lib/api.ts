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
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, contentType }),
  })

  if (!response.ok) {
    callbacks.onError(`Request failed: ${response.status}`)
    return
  }

  const reader = response.body?.getReader()
  if (!reader) {
    callbacks.onError('No response stream')
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (payload === '[DONE]') continue

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
            callbacks.onPipelineComplete()
            break
          case 'error':
            callbacks.onError(event.content ?? 'Unknown error')
            break
        }
      } catch {
        continue
      }
    }
  }
}
