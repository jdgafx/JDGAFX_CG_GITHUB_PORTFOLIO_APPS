import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  try {
    const body = (await req.json()) as { message?: unknown; history?: unknown }
    const { message, history } = body

    if (!message || typeof message !== 'string') {
      return Response.json({ error: 'message is required' }, { status: 400 })
    }

    const historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
    if (Array.isArray(history)) {
      for (const item of history as Array<{ role: string; content: string }>) {
        if (item.role === 'user' || item.role === 'assistant') {
          historyMessages.push({ role: item.role, content: item.content })
        }
      }
    }

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...historyMessages,
      { role: 'user', content: message },
    ]

    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1024,
      system: 'You are VoxAI, a friendly and helpful voice assistant. Keep responses concise and conversational — ideally 1-3 sentences. You are being used via voice interface.',
      messages,
    })

    const content = response.content[0]
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude')
    }

    return Response.json({ response: content.text })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    return Response.json({ error: message }, { status: 500 })
  }
}

export const config = {
  path: '/api/ai',
}
