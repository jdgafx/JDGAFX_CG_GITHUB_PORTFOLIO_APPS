import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface AgentConfig {
  role: string
  name: string
  systemPrompt: string
  buildUserMessage: (query: string, context: Record<string, string>) => string
}

const agents: AgentConfig[] = [
  {
    role: 'researcher',
    name: 'Researcher',
    systemPrompt:
      'You are a world-class research agent. Your task is to deeply research a topic and provide comprehensive, factual findings with specific data points, statistics, and key insights. Be thorough but concise. Cite sources where possible. Use markdown formatting.',
    buildUserMessage: (query: string) =>
      `Research the following topic thoroughly. Provide key findings, important data points, relevant statistics, and emerging trends.\n\nTopic: ${query}`,
  },
  {
    role: 'analyst',
    name: 'Analyst',
    systemPrompt:
      'You are an expert analytical agent. You take raw research findings and structure them into a clear, insightful analysis. Identify patterns, correlations, implications, and actionable insights. Use markdown formatting with headers and bullet points.',
    buildUserMessage: (query: string, ctx: Record<string, string>) =>
      `Analyze the following research findings on "${query}". Identify key patterns, implications, and insights.\n\nResearch Findings:\n${ctx['researcher']}`,
  },
  {
    role: 'critic',
    name: 'Critic',
    systemPrompt:
      'You are a rigorous critical review agent. You examine analyses for gaps, biases, logical fallacies, missing perspectives, and areas that need deeper investigation. Be constructive but thorough. Use markdown formatting.',
    buildUserMessage: (query: string, ctx: Record<string, string>) =>
      `Critically review this analysis on "${query}". Identify gaps, potential biases, missing perspectives, and areas for improvement.\n\nAnalysis:\n${ctx['analyst']}`,
  },
  {
    role: 'synthesizer',
    name: 'Synthesizer',
    systemPrompt:
      'You are a master synthesis agent. You combine research findings, analysis, and critical review into a final, polished, comprehensive report. The report should be well-structured, actionable, and ready for executive consumption. Use markdown formatting with clear sections.',
    buildUserMessage: (query: string, ctx: Record<string, string>) =>
      `Create a final comprehensive report on "${query}" by synthesizing all inputs below.\n\nResearch Findings:\n${ctx['researcher']}\n\nAnalysis:\n${ctx['analyst']}\n\nCritical Review:\n${ctx['critic']}`,
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
    return new Response('Method not allowed', { status: 405 })
  }

  const { query } = (await req.json()) as { query: string }

  if (!query || typeof query !== 'string') {
    return new Response('Missing query', { status: 400 })
  }

  const encoder = new TextEncoder()
  const context: Record<string, string> = {}

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (const agent of agents) {
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

          const response = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2048,
            system: agent.systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
            stream: true,
          })

          for await (const event of response) {
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              agentOutput += event.delta.text
              controller.enqueue(
                encoder.encode(
                  sseEvent({
                    type: 'agent_chunk',
                    agent: agent.role,
                    content: event.delta.text,
                  }),
                ),
              )
            }
            if (event.type === 'message_delta' && event.usage) {
              tokenCount = event.usage.output_tokens
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
