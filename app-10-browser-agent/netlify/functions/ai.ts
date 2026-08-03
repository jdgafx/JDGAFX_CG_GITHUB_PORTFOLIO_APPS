const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
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

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY not configured')
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
- thought: what the AI is thinking in this step (string, 1-2 sentences, first person)
- value?: optional string (text to type, or value to verify/extract)
- url?: current URL after this step
- pageContent?: one of "flights-search" | "flights-results" | "job-board" | "job-results" | "ecommerce" | "ecommerce-results" | "form" | "search-results" | "generic"

IMPORTANT RULES:
- The LAST step MUST be action "verify" or "extract" that summarizes the findings.
- For "extract" steps, the "value" field MUST contain the actual data found (e.g. a list of results, prices, job titles, etc.) — be specific with real-sounding data.
- For "extract" steps that list multiple results, put one result per line as "Name — detail, detail" so the simulated page can render the same rows.
- For "type" steps, name the field in "target" (e.g. "origin input", "destination input", "email field") so the typed text lands in the right box.
- For job searches: use pageContent "job-board" then "job-results" and include 3-5 realistic job listings in the final extract value.
- For price comparisons: include real-sounding prices and product names.
- For form filling: show confirmation of submission.
- Always include concrete, specific data in extract/verify values — never leave them vague.

Return ONLY valid JSON. No markdown. No explanation. Example format:
{"steps": [{"action": "navigate", "target": "google.com", "thought": "Opening Google...", "url": "https://google.com", "pageContent": "generic"}]}

Generate 6-10 steps that realistically simulate completing the user's task in a browser.`

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      // The latest-alias models can resolve to reasoning models, whose reasoning tokens eat the
      // completion budget and truncate the JSON mid-emit. Disable reasoning and keep headroom.
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
        max_tokens: envInt('OPENROUTER_MAX_TOKENS', DEFAULT_MAX_TOKENS),
        reasoning: { enabled: false },
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Task: ${task}` },
        ],
      }),
      signal: AbortSignal.timeout(envInt('OPENROUTER_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)),
    })

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

    return new Response(JSON.stringify({ steps }), { status: 200, headers: jsonHeaders })
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
