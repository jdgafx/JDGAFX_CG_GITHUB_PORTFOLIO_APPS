

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

    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3.5-haiku',
        max_tokens: 1024,
        messages: [
          {
            role: 'system',
            content: 'You are VoxAI, a friendly and helpful voice assistant. Keep responses concise and conversational — ideally 1-3 sentences. You are being used via voice interface.',
          },
          ...messages,
        ],
      }),
    })

    if (!aiResponse.ok) {
      throw new Error(`OpenRouter error: ${aiResponse.status} ${aiResponse.statusText}`)
    }

    const aiData = (await aiResponse.json()) as {
      choices: Array<{ message: { content: string } }>
    }
    const rawText = aiData.choices[0]?.message?.content
    if (!rawText) {
      throw new Error('Unexpected response type from OpenRouter')
    }

    return Response.json({ response: rawText })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    return Response.json({ error: message }, { status: 500 })
  }
}

export const config = {
  path: '/api/ai',
}
