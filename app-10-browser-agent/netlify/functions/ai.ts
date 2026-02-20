export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let task: string
  try {
    const body = (await req.json()) as { task?: string }
    task = body.task ?? ''
    if (!task) {
      return new Response(JSON.stringify({ error: 'task is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const systemPrompt = `You are a browser automation AI. Given a user task, return a JSON array of browser automation steps.

Each step must have:
- action: one of "navigate" | "find" | "click" | "type" | "extract" | "verify"
- target: what element or URL is targeted (string)
- thought: what the AI is thinking in this step (string, 1-2 sentences, first person)
- value?: optional string (text to type, or value to verify)
- url?: current URL after this step
- pageContent?: one of "flights-search" | "flights-results" | "ecommerce" | "form" | "generic"

Return ONLY valid JSON. No markdown. No explanation. Example format:
{"steps": [{"action": "navigate", "target": "google.com", "thought": "Opening Google...", "url": "https://google.com", "pageContent": "generic"}]}

Generate 6-10 steps that realistically simulate completing the user's task in a browser.`

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
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Task: ${task}` },
        ],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`OpenRouter error: ${response.status} ${errText}`)
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      throw new Error('No content in response')
    }

    const parsed = JSON.parse(content) as { steps: unknown }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(
      JSON.stringify({ error: 'Failed to generate scenario' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}

export const config = { path: '/api/ai' }
