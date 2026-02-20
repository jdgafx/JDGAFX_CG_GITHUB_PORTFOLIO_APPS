const STEP_PROMPTS: Record<string, string> = {
  research: 'Research the topic thoroughly. Provide key facts, statistics, expert opinions, and relevant background. Be comprehensive.',
  outline: 'Create a detailed content outline with sections, subsections, and key points to cover in each.',
  draft: 'Write a complete first draft based on the outline. Make it engaging, informative, and well-structured.',
  edit: 'Edit and improve the draft. Fix grammar, improve flow, strengthen arguments, add transitions, and enhance clarity.',
  polish: 'Polish the final version. Ensure perfect prose, compelling opening, strong conclusion, and professional tone.',
}

const STEPS = ['research', 'outline', 'draft', 'edit', 'polish'] as const

async function streamStep(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  onChunk: (text: string) => void,
): Promise<void> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4.5',
      max_tokens: 1024,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`OpenRouter error: ${response.status} ${errText}`)
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

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
          onChunk(delta)
        }
      } catch (_) { }
    }
  }
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }), { status: 500 })
  }

  const { topic, contentType } = await req.json() as { topic: string; contentType: string }

  if (!topic) {
    return new Response(JSON.stringify({ error: 'Topic required' }), { status: 400 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      let context = ''

      for (const step of STEPS) {
        send({ type: 'step_start', step })

        const systemPrompt = `You are an expert content creator. The user wants a ${contentType} about: "${topic}". Current step: ${step.toUpperCase()}. ${STEP_PROMPTS[step]}`

        const userMessage = step === 'research'
          ? `Create ${contentType} about: ${topic}`
          : `Previous work:\n${context}\n\nNow ${step} this content.`

        let stepContent = ''

        try {
          await streamStep(apiKey, systemPrompt, userMessage, (text) => {
            stepContent += text
            send({ type: 'step_chunk', step, content: text })
          })
        } catch (err) {
          send({ type: 'step_chunk', step, content: `Error: ${(err as Error).message}` })
        }

        context = stepContent
        send({ type: 'step_complete', step, content: stepContent })
      }

      send({ type: 'pipeline_complete' })
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

export const config = { path: '/api/ai' }
