interface AgentConfig {
  role: string
  name: string
  systemPrompt: string
  buildUserMessage: (query: string, context: Record<string, string>) => string
  maxTokens: number
  /** Hard wall-clock timeout per agent — abort stream after this many ms */
  timeoutMs: number
}

/** Trim context to stay within time budget — shorter input = faster generation */
function trimCtx(text: string, maxChars = 800): string {
  return text.length > maxChars ? text.slice(0, maxChars) + '\n[trimmed]' : text
}

/**
 * Time budget: Netlify functions timeout at 26s.
 * 4 agents × ~5s each = ~20s generation + ~4s network overhead = 24s.
 * Per-agent timeouts guarantee we never exceed the budget.
 */
const agents: AgentConfig[] = [
  {
    role: 'researcher',
    name: 'Researcher',
    systemPrompt:
      'You are a research assistant. Give 3-5 bullet points with key facts. Use markdown. STRICT LIMIT: 150 words max. Do NOT write long paragraphs.',
    buildUserMessage: (query: string) =>
      `Research: ${query}\n\n3-5 bullet points only. Be extremely concise.`,
    maxTokens: 250,
    timeoutMs: 5500,
  },
  {
    role: 'analyst',
    name: 'Analyst',
    systemPrompt:
      'You are an analyst. Identify 2-3 key patterns from the research. Markdown bullets. STRICT LIMIT: 150 words max.',
    buildUserMessage: (_query: string, ctx: Record<string, string>) =>
      `Analyze:\n${trimCtx(ctx['researcher'])}\n\n2-3 key patterns only. Extremely concise.`,
    maxTokens: 250,
    timeoutMs: 5500,
  },
  {
    role: 'critic',
    name: 'Critic',
    systemPrompt:
      'You are a critic. Note 2-3 gaps or missing angles. Markdown bullets. STRICT LIMIT: 100 words max.',
    buildUserMessage: (_query: string, ctx: Record<string, string>) =>
      `Review:\n${trimCtx(ctx['analyst'])}\n\n2-3 gaps only. Very brief.`,
    maxTokens: 200,
    timeoutMs: 4500,
  },
  {
    role: 'synthesizer',
    name: 'Synthesizer',
    systemPrompt:
      'You are a synthesis agent. Combine research, analysis, and critique into a final report with clear markdown sections. Be comprehensive but concise — aim for 200-300 words.',
    buildUserMessage: (query: string, ctx: Record<string, string>) =>
      `Final report on "${query}".\n\nResearch:\n${trimCtx(ctx['researcher'])}\n\nAnalysis:\n${trimCtx(ctx['analyst'])}\n\nGaps:\n${trimCtx(ctx['critic'])}`,
    maxTokens: 500,
    timeoutMs: 8000,
  },
]

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`
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

          controller.enqueue(
            encoder.encode(
              sseEvent({ type: 'agent_start', agent: agent.role }),
            ),
          )

          const userMessage = agent.buildUserMessage(query, context)
          let agentOutput = ''
          let tokenCount = 0
          let timedOut = false

          // Per-agent AbortController enforces the hard timeout
          const agentAbort = new AbortController()
          const timer = setTimeout(() => agentAbort.abort(), agent.timeoutMs)

          try {
            const response = await fetch(
              'https://openrouter.ai/api/v1/chat/completions',
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${apiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'google/gemini-2.0-flash-001',
                  max_tokens: agent.maxTokens,
                  stream: true,
                  messages: [
                    { role: 'system', content: agent.systemPrompt },
                    { role: 'user', content: userMessage },
                  ],
                }),
                signal: agentAbort.signal,
              },
            )

            if (!response.ok) {
              const body = await response.text().catch(() => '')
              // Single fast retry on 429
              if (response.status === 429) {
                await new Promise(r => setTimeout(r, 800))
                const retry = await fetch(
                  'https://openrouter.ai/api/v1/chat/completions',
                  {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${apiKey}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      model: 'google/gemini-2.0-flash-001',
                      max_tokens: agent.maxTokens,
                      stream: true,
                      messages: [
                        { role: 'system', content: agent.systemPrompt },
                        { role: 'user', content: userMessage },
                      ],
                    }),
                    signal: agentAbort.signal,
                  },
                )
                if (!retry.ok) {
                  throw new Error(`OpenRouter ${retry.status} after retry`)
                }
                // Process the retry response below — reassign not possible, so inline
                if (retry.body) {
                  const reader = retry.body.getReader()
                  const decoder = new TextDecoder()
                  let buffer = ''
                  try {
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
                  } catch { timedOut = agentAbort.signal.aborted }
                }
                // Skip the main response processing
                clearTimeout(timer)
                context[agent.role] = agentOutput || '(No output — rate limited)'
                controller.enqueue(
                  encoder.encode(sseEvent({ type: 'agent_complete', agent: agent.role, tokens: tokenCount })),
                )
                continue
              }
              throw new Error(`OpenRouter ${response.status}: ${body || response.statusText}`)
            }

            if (!response.body) {
              throw new Error(`No response body for ${agent.role}`)
            }

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            try {
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
                    const content = parsed.choices?.[0]?.delta?.content
                    if (content) {
                      agentOutput += content
                      controller.enqueue(
                        encoder.encode(sseEvent({ type: 'agent_chunk', agent: agent.role, content })),
                      )
                    }
                    if (parsed.usage?.completion_tokens) {
                      tokenCount = parsed.usage.completion_tokens
                    }
                  } catch { /* skip malformed SSE */ }
                }
              }
            } catch {
              // AbortController killed the stream — use partial output
              timedOut = agentAbort.signal.aborted
            }

            // Flush remaining buffer
            if (buffer.trim()) {
              for (const line of buffer.split('\n')) {
                const trimmed = line.trim()
                if (!trimmed || !trimmed.startsWith('data: ')) continue
                const data = trimmed.slice(6)
                if (data === '[DONE]') continue
                try {
                  const parsed = JSON.parse(data)
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
          } catch (err) {
            // Fetch itself was aborted (timeout before first byte)
            timedOut = agentAbort.signal.aborted
            if (!timedOut) {
              // Real error, not a timeout
              throw err
            }
          } finally {
            clearTimeout(timer)
          }

          if (timedOut && agentOutput) {
            // We got partial output before timeout — that's fine, use it
            controller.enqueue(
              encoder.encode(
                sseEvent({ type: 'agent_chunk', agent: agent.role, content: '\n\n*(response trimmed for speed)*' }),
              ),
            )
            agentOutput += '\n\n*(response trimmed for speed)*'
          }

          context[agent.role] = agentOutput || '(No output generated)'

          controller.enqueue(
            encoder.encode(
              sseEvent({ type: 'agent_complete', agent: agent.role, tokens: tokenCount }),
            ),
          )
        }

        controller.enqueue(
          encoder.encode(sseEvent({ type: 'session_complete', agent: 'synthesizer' })),
        )
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        controller.enqueue(
          encoder.encode(sseEvent({ type: 'agent_error', agent: 'system', error: message })),
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
