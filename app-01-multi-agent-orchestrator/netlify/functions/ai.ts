

interface AgentConfig {
  role: string
  name: string
  systemPrompt: string
  buildUserMessage: (query: string, context: Record<string, string>) => string
  maxTokens: number
}

/** Trim context to stay within time budget — long inputs = slow generation */
function trimCtx(text: string, maxChars = 1200): string {
  return text.length > maxChars ? text.slice(0, maxChars) + '\n\n[Trimmed for brevity]' : text
}

const agents: AgentConfig[] = [
  {
    role: 'researcher',
    name: 'Researcher',
    systemPrompt: 'Research agent. Provide concise factual findings with data. Markdown. 3-5 bullet points max.',
    buildUserMessage: (query: string) =>
      `Research: ${query}\n\nProvide 3-5 key findings with data points. Be brief.`,
    maxTokens: 500,
  },
  {
    role: 'analyst',
    name: 'Analyst',
    systemPrompt: 'Analyst agent. Identify patterns and implications from research. Markdown. Be concise.',
    buildUserMessage: (query: string, ctx: Record<string, string>) =>
      `Analyze findings on "${query}". Key patterns and insights.\n\n${trimCtx(ctx['researcher'])}`,
    maxTokens: 500,
  },
  {
    role: 'critic',
    name: 'Critic',
    systemPrompt: 'Critic agent. Identify gaps and missing perspectives. Constructive and brief. Markdown.',
    buildUserMessage: (query: string, ctx: Record<string, string>) =>
      `Review analysis on "${query}". Note gaps.\n\n${trimCtx(ctx['analyst'])}`,
    maxTokens: 400,
  },
  {
    role: 'synthesizer',
    name: 'Synthesizer',
    systemPrompt: 'Synthesis agent. Combine inputs into a polished final report with clear sections. Markdown.',
    buildUserMessage: (query: string, ctx: Record<string, string>) =>
      `Final report on "${query}".\n\nResearch:\n${trimCtx(ctx['researcher'])}\n\nAnalysis:\n${trimCtx(ctx['analyst'])}\n\nReview:\n${trimCtx(ctx['critic'])}`,
    maxTokens: 1000,
  },
]

/** Zero delays — 4 sequential calls within 26s Netlify timeout leaves no room for idle time */
const AGENT_DELAYS = [0, 0, 0, 0]

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
      try {
        for (let i = 0; i < agents.length; i++) {
          const agent = agents[i]

          // Minimal delay between agents if configured
          const delayMs = AGENT_DELAYS[i]
          if (delayMs > 0) {
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
