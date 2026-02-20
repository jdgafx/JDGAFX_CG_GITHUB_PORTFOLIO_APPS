export const config = { path: '/api/ai' }

// Map frontend Anthropic model IDs to OpenRouter model IDs
const MODEL_MAP: Record<string, string> = {
  'claude-haiku-4.5': 'anthropic/claude-haiku-4.5',
  'claude-sonnet-4.6': 'anthropic/claude-sonnet-4.6',
  'claude-sonnet-4': 'anthropic/claude-sonnet-4',
  'claude-3-5-haiku-20241022': 'anthropic/claude-3.5-haiku',
  'claude-sonnet-4-20250514': 'anthropic/claude-sonnet-4',
  'claude-3-5-sonnet-20241022': 'anthropic/claude-3.5-sonnet',
}

function resolveModel(model: string): string {
  if (MODEL_MAP[model]) return MODEL_MAP[model]
  if (model.startsWith('anthropic/')) return model
  if (model.startsWith('claude')) return `anthropic/${model}`
  return model
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return new Response('OPENROUTER_API_KEY not configured', { status: 500 })
  }

  let body: {
    model: string
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    system?: string
    max_tokens?: number
    temperature?: number
  }

  try {
    body = await req.json() as typeof body
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { model, messages, system, max_tokens = 1024, temperature = 0.7 } = body

  if (!model || !messages?.length) {
    return new Response('model and messages are required', { status: 400 })
  }

  const orModel = resolveModel(model)

  const startTime = Date.now()

  const openRouterMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: orModel,
            messages: openRouterMessages,
            max_tokens,
            temperature,
            stream: true,
          }),
        })

        if (!response.ok) {
          const errText = await response.text()
          send({ type: 'error', message: `OpenRouter error: ${response.status} ${errText}` })
          controller.close()
          return
        }

        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let inputTokens = 0
        let outputTokens = 0

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('data: ')) continue
            const data = trimmed.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)
              const delta = parsed.choices?.[0]?.delta?.content
              if (delta) {
                send({ type: 'text', text: delta })
              }
              if (parsed.usage) {
                inputTokens = parsed.usage.prompt_tokens ?? 0
                outputTokens = parsed.usage.completion_tokens ?? 0
              }
            } catch (_) { }
          }
        }

        const latencyMs = Date.now() - startTime
        send({ type: 'done', latencyMs, inputTokens, outputTokens })
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        send({ type: 'error', message: (err as Error).message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
