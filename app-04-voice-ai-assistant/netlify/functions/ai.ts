const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500, headers: corsHeaders })
  }

  try {
    const body = (await req.json()) as { message?: unknown; history?: unknown }
    const { message, history } = body

    if (!message || typeof message !== 'string') {
      return Response.json({ error: 'message is required' }, { status: 400, headers: corsHeaders })
    }

    if (message.length > 5000) {
      return Response.json({ error: 'Message exceeds maximum allowed length' }, { status: 400, headers: corsHeaders })
    }

    const historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
    if (Array.isArray(history)) {
      for (const item of history as Array<{ role: string; content: string }>) {
        if ((item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string') {
          historyMessages.push({ role: item.role, content: item.content.slice(0, 5000) })
        }
      }
    }

    // Keep only the last 20 history messages to avoid token overflow
    const trimmedHistory = historyMessages.slice(-20)

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...trimmedHistory,
      { role: 'user', content: message },
    ]

    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4.5',
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

    return Response.json({ response: rawText }, { headers: corsHeaders })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    return Response.json({ error: message }, { status: 500, headers: corsHeaders })
  }
}

export const config = {
  path: '/api/ai',
}
