

interface AgentConfig {
  role: string
  name: string
  systemPrompt: string
  buildUserMessage: (query: string, context: Record<string, string>) => string
  maxTokens: number
}

const agents: AgentConfig[] = [
  {
    role: 'researcher',
    name: 'Researcher',
    systemPrompt:
      'You are a research agent. Provide concise, factual findings with key data points and statistics. Use markdown. Keep it focused — 3-5 key points max.',
    buildUserMessage: (query: string) =>
      `Research this topic. Provide 3-5 key findings with data points.\n\nTopic: ${query}`,
    maxTokens: 800,
  },
  {
    role: 'analyst',
    name: 'Analyst',
    systemPrompt:
      'You are an analytical agent. Structure research into clear insights. Identify patterns and implications. Use markdown. Be concise.',
    buildUserMessage: (query: string, ctx: Record<string, string>) =>
      `Analyze these findings on "${query}". Identify key patterns and insights.\n\n${ctx['researcher']}`,
    maxTokens: 800,
  },
  {
    role: 'critic',
    name: 'Critic',
    systemPrompt:
      'You are a critical review agent. Identify gaps, biases, and missing perspectives. Be constructive and concise. Use markdown.',
    buildUserMessage: (query: string, ctx: Record<string, string>) =>
      `Review this analysis on "${query}". Note gaps and improvements.\n\n${ctx['analyst']}`,
    maxTokens: 600,
  },
  {
    role: 'synthesizer',
    name: 'Synthesizer',
    systemPrompt:
      'You are a synthesis agent. Combine all inputs into a polished, comprehensive final report with clear sections. Use markdown formatting.',
    buildUserMessage: (query: string, ctx: Record<string, string>) =>
      `Create a final report on "${query}" from these inputs.\n\nResearch:\n${ctx['researcher']}\n\nAnalysis:\n${ctx['analyst']}\n\nReview:\n${ctx['critic']}`,
    maxTokens: 1500,
  },
]

/**
 * Minimal delays between agents — Netlify functions have a ~26s wall-clock timeout.
 * Every millisecond counts. Just enough gap to avoid OpenRouter rate limits.
 */
const AGENT_DELAYS = [0, 200, 200, 300]

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

/** Single retry on 429 with short backoff — can't afford long retries within Netlify's timeout */
async function fetchOnce(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init)
  if (response.ok) return response
  // One fast retry on rate limit
  if (response.status === 429) {
    await new Promise(r => setTimeout(r, 1000))
    const retry = await fetch(url, init)
    if (retry.ok) return retry
    const body = await retry.text().catch(() => '')
    throw new Error(`OpenRouter 429 after retry: ${body || retry.statusText}`)
  }
  const body = await response.text().catch(() => '')
  throw new Error(`OpenRouter ${response.status}: ${body || response.statusText}`)
}

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  let query: string
  try {
    const body = (await req.json()) as { query?: string }
    query = body.query ?? ''
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  if (!query || typeof query !== 'string') {
    return new Response('Missing query', { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return new Response('OPENROUTER_API_KEY not configured', { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const encoder = new TextEncoder()
  const context: Record<string, string> = {}

  const stream = new ReadableStream({
    async start(controller) {
      /** Send a keepalive comment to prevent Netlify from closing the idle connection */
      const keepalive = () => controller.enqueue(encoder.encode(': keepalive\n\n'))

      try {
        for (let i = 0; i < agents.length; i++) {
          const agent = agents[i]

          // Progressive delay between agents — send keepalive so connection stays open
          const delayMs = AGENT_DELAYS[i]
          if (delayMs > 0) {
            keepalive()
            await new Promise(r => setTimeout(r, delayMs))
          }

          controller.enqueue(
            encoder.encode(
              sseEvent({
                type: 'agent_start',
                agent: agent.role,
              }),
            ),
          )

          const userMessage = agent.buildUserMessage(query, context)
          let agentOutput = ''
          let tokenCount = 0

          const response = await fetchOnce(
            'https://openrouter.ai/api/v1/chat/completions',
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'anthropic/claude-haiku-4.5',
                max_tokens: agent.maxTokens,
                stream: true,
                messages: [
                  { role: 'system', content: agent.systemPrompt },
                  { role: 'user', content: userMessage },
                ],
              }),
            },
          )

          if (!response.body) {
            throw new Error(`No response body from OpenRouter for ${agent.role}`)
          }

          const reader = response.body.getReader()
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
                const parsed = JSON.parse(data) as {
                  choices?: Array<{ delta?: { content?: string } }>
                  usage?: { completion_tokens?: number }
                }
                const content = parsed.choices?.[0]?.delta?.content
                if (content) {
                  agentOutput += content
                  controller.enqueue(
                    encoder.encode(
                      sseEvent({
                        type: 'agent_chunk',
                        agent: agent.role,
                        content,
                      }),
                    ),
                  )
                }
                if (parsed.usage?.completion_tokens) {
                  tokenCount = parsed.usage.completion_tokens
                }
              } catch {
                // skip malformed SSE lines
              }
            }
          }

          // Flush remaining buffer
          if (buffer.trim()) {
            for (const line of buffer.split('\n')) {
              const trimmed = line.trim()
              if (!trimmed || !trimmed.startsWith('data: ')) continue
              const data = trimmed.slice(6)
              if (data === '[DONE]') continue
              try {
                const parsed = JSON.parse(data) as {
                  choices?: Array<{ delta?: { content?: string } }>
                  usage?: { completion_tokens?: number }
                }
                const content = parsed.choices?.[0]?.delta?.content
                if (content) {
                  agentOutput += content
                  controller.enqueue(
                    encoder.encode(sseEvent({ type: 'agent_chunk', agent: agent.role, content })),
                  )
                }
                if (parsed.usage?.completion_tokens) tokenCount = parsed.usage.completion_tokens
              } catch { /* skip */ }
            }
          }

          context[agent.role] = agentOutput

          controller.enqueue(
            encoder.encode(
              sseEvent({
                type: 'agent_complete',
                agent: agent.role,
                tokens: tokenCount,
              }),
            ),
          )
        }

        controller.enqueue(
          encoder.encode(
            sseEvent({ type: 'session_complete', agent: 'synthesizer' }),
          ),
        )
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        controller.enqueue(
          encoder.encode(
            sseEvent({
              type: 'agent_error',
              agent: 'system',
              error: message,
            }),
          ),
        )
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
