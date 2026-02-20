import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const STEP_PROMPTS: Record<string, string> = {
  research: 'Research the topic thoroughly. Provide key facts, statistics, expert opinions, and relevant background. Be comprehensive.',
  outline: 'Create a detailed content outline with sections, subsections, and key points to cover in each.',
  draft: 'Write a complete first draft based on the outline. Make it engaging, informative, and well-structured.',
  edit: 'Edit and improve the draft. Fix grammar, improve flow, strengthen arguments, add transitions, and enhance clarity.',
  polish: 'Polish the final version. Ensure perfect prose, compelling opening, strong conclusion, and professional tone.',
}

const STEPS = ['research', 'outline', 'draft', 'edit', 'polish'] as const

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
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

        const messageStream = client.messages.stream({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        })

        for await (const event of messageStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            const text = event.delta.text
            stepContent += text
            send({ type: 'step_chunk', step, content: text })
          }
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
