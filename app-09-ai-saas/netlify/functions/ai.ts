export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return new Response('OPENROUTER_API_KEY not configured', { status: 500 })
  }

  let body: { metrics?: { totalApiCalls: number; totalTokens: number; avgResponseTime: number; totalCost: number; apiCallsTrend: number; tokensTrend: number; responseTimeTrend: number; costTrend: number } }
  try {
    body = await req.json() as typeof body
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const { metrics } = body
  if (!metrics || typeof metrics.totalApiCalls !== 'number') {
    return new Response(JSON.stringify({ error: 'metrics object with totalApiCalls is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const prompt = `You are an expert SaaS analytics consultant. Analyze these API usage metrics from the last 15 days and provide 4-5 concise, actionable insights:

Metrics:
- Total API Calls: ${metrics.totalApiCalls.toLocaleString()} (${metrics.apiCallsTrend > 0 ? '+' : ''}${metrics.apiCallsTrend}% vs prev 15 days)
- Total Tokens: ${metrics.totalTokens.toLocaleString()} (${metrics.tokensTrend > 0 ? '+' : ''}${metrics.tokensTrend}% vs prev 15 days)
- Average Response Time: ${metrics.avgResponseTime}ms (${metrics.responseTimeTrend > 0 ? '+' : ''}${metrics.responseTimeTrend}% vs prev 15 days)
- Total Cost: $${metrics.totalCost} (${metrics.costTrend > 0 ? '+' : ''}${metrics.costTrend}% vs prev 15 days)

Provide specific, data-driven insights. Be direct and actionable. Format as numbered insights with brief explanations.`

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
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
            messages: [{ role: 'user', content: prompt }],
          }),
        })

        if (!response.ok) {
          const errText = await response.text()
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: `Error: ${response.status} ${errText}` })}\n\n`))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
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
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: delta })}\n\n`))
              }
            } catch (_) { }
          }
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: `Error: ${message}` })}\n\n`))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
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

export const config = { path: '/api/ai' }
