import Anthropic from '@anthropic-ai/sdk'

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const body = await req.json() as {
    metrics: {
      totalApiCalls: number
      totalTokens: number
      avgResponseTime: number
      totalCost: number
      apiCallsTrend: number
      tokensTrend: number
      responseTimeTrend: number
      costTrend: number
    }
  }

  const { metrics } = body

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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
      const messageStream = await client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        stream: true,
        messages: [{ role: 'user', content: prompt }],
      })

      for await (const event of messageStream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          const payload = JSON.stringify({ text: event.delta.text })
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
        }
      }

      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
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
