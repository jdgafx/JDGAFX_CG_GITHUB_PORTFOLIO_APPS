export const config = { path: '/api/ai' }

interface RequestBody {
  image: string
  mediaType: string
  mode: 'describe' | 'analyze' | 'qa' | 'extract'
  question?: string
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return new Response('OPENROUTER_API_KEY not configured', { status: 500 })
  }

  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  const { image, mediaType, mode, question } = body
  if (!image || !mode) {
    return new Response(JSON.stringify({ error: 'image and mode are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const systemPrompts: Record<string, string> = {
    describe:
      'Provide a rich, detailed description of this image. Cover everything you observe: subjects, setting, mood, colors, composition, lighting, and any interesting or notable details.',
    analyze:
      'Provide a thorough technical analysis of this image. Cover: composition and framing, color palette and tones, key objects and their relationships, any visible text, image quality, and overall visual impact.',
    qa: `Answer the following question about this image concisely and accurately: ${question ?? 'What do you see?'}`,
    extract:
      'Extract all text, numbers, data, tables, and structured information from this image. Present the extracted content clearly and organized, preserving the original structure where possible.',
  }

  const systemPrompt = systemPrompts[mode] ?? systemPrompts['describe']!

  const userText =
    mode === 'qa'
      ? (question ?? 'What do you see in this image?')
      : 'Please analyze this image as requested.'

  const safeMediaType = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType)
    ? mediaType
    : 'image/jpeg'
  const imageUrl = `data:${safeMediaType};base64,${image}`

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      const send = (payload: Record<string, string>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        )
      }

      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'anthropic/claude-sonnet-4.6',
            max_tokens: 1024,
            stream: true,
            messages: [
              {
                role: 'system',
                content: systemPrompt,
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: { url: imageUrl },
                  },
                  {
                    type: 'text',
                    text: userText,
                  },
                ],
              },
            ],
          }),
        })

        if (!response.ok) {
          const errText = await response.text()
          send({ error: `OpenRouter error: ${response.status} ${errText}` })
          controller.close()
          return
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
                send({ text: delta })
              }
            } catch (_) { }
          }
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        send({ error: message })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
