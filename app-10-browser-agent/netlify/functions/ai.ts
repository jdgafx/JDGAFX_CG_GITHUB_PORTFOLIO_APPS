const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

import { generationOptions, getProvider, requestWithContentRetry } from '../shared/provider'

const DEFAULT_MODEL = '~google/gemini-flash-latest'
const DEFAULT_MAX_TOKENS = 4096
/** Netlify's synchronous function cap is 10s; leave room to return a handled error. */
const DEFAULT_TIMEOUT_MS = 8500
const MAX_ERROR_DETAIL = 300

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: jsonHeaders })
}

/** An error whose message is curated user-facing copy, safe to send to the client verbatim. */
class ScenarioError extends Error {}

/**
 * Pull the JSON payload out of a model response: drop any markdown fence (the closing fence is
 * missing when the output was truncated), then forward-scan from the first brace/bracket to its
 * balanced partner so trailing prose or nested braces cannot break the slice.
 */
function extractJson(raw: string): string {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

  const start = text.search(/[{[]/)
  if (start === -1) return text

  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth++
    else if (ch === close && --depth === 0) return text.slice(start, i + 1)
  }

  // Unbalanced — the model output was cut off. Hand back what there is so the parse error is specific.
  return text.slice(start)
}

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  const provider = getProvider(DEFAULT_MODEL)
  if (!provider) {
    console.error('No server-side AI provider configured')
    return jsonError('The agent service is not configured yet. Please try again later.', 500)
  }

  let task: string
  try {
    const body = (await req.json()) as { task?: unknown }
    if (typeof body.task !== 'string' || !body.task.trim()) {
      return jsonError('task is required', 400)
    }
    task = body.task
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const systemPrompt = `You are a browser automation AI. Given a user task, return a JSON array of browser automation steps.

Each step must have:
- action: one of "navigate" | "find" | "click" | "type" | "extract" | "verify"
- target: what element or URL is targeted (string)
- thought: concise user-visible rationale for this planned action (string, 1-2 sentences; never hidden chain-of-thought)
- value?: optional string (text to type, or value to verify/extract)
- url?: current URL after this step
- pageContent?: one of "flights-search" | "flights-results" | "job-board" | "job-results" | "ecommerce" | "ecommerce-results" | "form" | "search-results" | "generic"

IMPORTANT RULES:
- The LAST step MUST be action "verify" or "extract" that summarizes the findings.
- For "extract" and "verify" steps, use "value" only as a concise description of what the executor should observe; never invent results, prices, titles, or other page data.
- For "type" steps, name the field in "target" (e.g. "origin input", "destination input", "email field") so the typed text lands in the right box.
- For job searches and price comparisons, describe the requested observation in the final extract/verify target; the external browser result is the source of truth.
- For form filling, only report confirmation when the live page visibly confirms it.
- Never claim that a page was visited or a result was found in the plan itself.

Return ONLY valid JSON. No markdown. No explanation. Example format:
{"steps": [{"action": "navigate", "target": "google.com", "thought": "Opening Google...", "url": "https://google.com", "pageContent": "generic"}]}

Generate 6-10 steps that realistically simulate completing the user's task in a browser.`

  try {
    const response = await requestWithContentRetry(() => fetch(provider.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      // The latest-alias models can resolve to reasoning models, whose reasoning tokens eat the
      // completion budget and truncate the JSON mid-emit. Disable reasoning and keep headroom.
      body: JSON.stringify({
        model: provider.model,
        ...generationOptions(provider, envInt('OPENROUTER_MAX_TOKENS', DEFAULT_MAX_TOKENS)),
        reasoning: { enabled: false },
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Task: ${task}` },
        ],
      }),
      signal: AbortSignal.timeout(envInt('OPENROUTER_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)),
    }))

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.error(`OpenRouter error ${response.status}: ${errText.slice(0, MAX_ERROR_DETAIL)}`)
      throw new ScenarioError(
        response.status === 402
          ? 'The AI service is out of credits right now. Please try again later.'
          : response.status === 429
            ? 'The AI service is handling too many requests. Wait a moment and try again.'
            : 'The AI service returned an error. Try again in a moment.',
      )
    }

    const data = await response.json() as {
      model?: string
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
    }
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      throw new ScenarioError('The model returned an empty response. Try again.')
    }

    const jsonText = extractJson(content)
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      const truncated = data.choices?.[0]?.finish_reason === 'length'
      throw new ScenarioError(
        truncated
          ? 'The model ran out of room before finishing this scenario. Try a shorter task.'
          : 'The model returned a response the agent could not read. Try again.',
      )
    }

    const steps = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? (parsed as { steps?: unknown }).steps
        : undefined
    if (!Array.isArray(steps)) {
      throw new ScenarioError('The model returned a scenario with no steps. Try again.')
    }

    return new Response(JSON.stringify({ steps, served_model: data.model ?? provider.model }), { status: 200, headers: jsonHeaders })
  } catch (err) {
    // fetch may surface the abort reason directly or wrapped as the cause.
    const thrown = err as { name?: string; message?: string; cause?: { name?: string } } | null
    const names = [thrown?.name, thrown?.cause?.name]
    if (names.includes('TimeoutError') || names.includes('AbortError')) {
      return jsonError('The model took too long to respond. Try again or pick a shorter task.', 504)
    }
    if (err instanceof ScenarioError) {
      return jsonError(err.message, 500)
    }
    // Anything else is internal — log it, never send it to the client.
    console.error('scenario generation failed:', err)
    return jsonError('Something went wrong while generating this scenario. Please try again.', 500)
  }
}

export const config = { path: '/api/ai' }
