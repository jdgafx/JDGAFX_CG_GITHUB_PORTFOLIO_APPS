import Anthropic from '@anthropic-ai/sdk'

export const config = { path: '/api/ai' }

type ValidMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

const VALID_MEDIA_TYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

function isValidMediaType(mt: string): mt is ValidMediaType {
  return VALID_MEDIA_TYPES.has(mt)
}

interface RequestBody {
  image: string
  mediaType: string
  mode: 'describe' | 'analyze' | 'qa' | 'extract'
  question?: string
}

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] })

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const body = (await req.json()) as RequestBody
  const { image, mediaType, mode, question } = body

  const safeMediaType: ValidMediaType = isValidMediaType(mediaType)
    ? mediaType
    : 'image/jpeg'

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

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      const send = (payload: Record<string, string>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        )
      }

      try {
        const messageStream = await client.messages.create({
          model: 'claude-opus-4-5',
          max_tokens: 1024,
          stream: true,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: safeMediaType,
                    data: image,
                  },
                },
                {
                  type: 'text',
                  text: userText,
                },
              ],
            },
          ],
        })

        for await (const event of messageStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            send({ text: event.delta.text })
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
