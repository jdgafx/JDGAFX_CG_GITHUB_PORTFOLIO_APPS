import Anthropic from '@anthropic-ai/sdk'
import type { Handler } from '@netlify/functions'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  let task: string
  try {
    const body = JSON.parse(event.body ?? '{}') as { task?: string }
    task = body.task ?? ''
    if (!task) {
      return { statusCode: 400, body: JSON.stringify({ error: 'task is required' }) }
    }
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }
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
    const message = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Task: ${task}` }],
    })

    const content = message.content[0]
    if (content.type !== 'text') {
      throw new Error('Unexpected response type')
    }

    const parsed = JSON.parse(content.text) as { steps: unknown }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    }
  } catch {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to generate scenario' }),
    }
  }
}

export const config = { path: '/api/ai' }
