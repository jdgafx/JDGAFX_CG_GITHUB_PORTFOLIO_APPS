import Anthropic from '@anthropic-ai/sdk'

export const config = { path: '/api/ai' }

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response('ANTHROPIC_API_KEY not configured', { status: 500 })
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

  const client = new Anthropic({ apiKey })
  const startTime = Date.now()

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const params: Anthropic.MessageStreamParams = {
          model,
          max_tokens,
          temperature,
          messages,
        }
        if (system) params.system = system

        const anthropicStream = await client.messages.stream(params)

        for await (const event of anthropicStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            send({ type: 'text', text: event.delta.text })
          }
        }

        const finalMsg = await anthropicStream.finalMessage()
        const latencyMs = Date.now() - startTime

        send({
          type: 'done',
          latencyMs,
          inputTokens: finalMsg.usage.input_tokens,
          outputTokens: finalMsg.usage.output_tokens,
        })

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
