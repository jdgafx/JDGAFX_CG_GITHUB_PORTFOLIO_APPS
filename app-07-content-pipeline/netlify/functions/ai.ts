type StepId = 'research' | 'outline' | 'draft' | 'edit' | 'polish'
import { generationOptions, getProviders, type ProviderConfig } from '../shared/provider'

const DEFAULT_MODEL = 'nvidia/nemotron-3-nano-30b-a3b:free'
const APP_TITLE = 'ContentForge'
const DEFAULT_SITE_URL = 'https://jdgafx-app-07-content-pipeline.netlify.app'
const DEFAULT_CONTENT_TYPE = 'Blog Post'
const MAX_TOPIC_CHARS = 400
const MAX_CONTEXT_CHARS = 1800

const SITE_URL = process.env.URL || DEFAULT_SITE_URL

const STEPS: StepId[] = ['research', 'outline', 'draft', 'edit', 'polish']

// Marks an error whose message is already curated end-user copy; anything else
// stays in the function log and reaches the client as a generic message.
class UserFacingError extends Error {}

const STEP_MAX_TOKENS: Record<StepId, number> = {
  research: 2048,
  outline: 2048,
  draft: 2048,
  edit: 2048,
  polish: 2048,
}

// Each request gets one step, and a Netlify function is killed at 30s. The
// token ceilings above exist so nothing is cut off mid-word; these word
// budgets are what actually keep a step's streaming time inside the wall.
// Without them each step inflates on the last and edit/polish overrun.
const STEP_WORD_BUDGETS: Record<StepId, number> = {
  research: 80,
  outline: 100,
  draft: 160,
  edit: 160,
  polish: 160,
}

// Leave enough room for a curated terminal event before Netlify's function
// wall. The client can retry this step once, while Stop/Resume still uses the
// request signal and remains authoritative.
const STEP_TIMEOUT_MS = 26_000
const MODEL_TIMEOUT_MS = 6_500

// Which earlier steps each step is allowed to see. Keeps prompts bounded while
// making sure the draft still has the research behind it.
const STEP_INPUTS: Record<StepId, StepId[]> = {
  research: [],
  outline: ['research'],
  draft: ['research', 'outline'],
  edit: ['outline', 'draft'],
  polish: ['edit'],
}

const STEP_PROMPTS: Record<StepId, string> = {
  research: 'Produce a tight research brief: the key facts, figures, expert views and background worth using. Dense notes, not prose — no introduction and no conclusion.',
  outline: 'Produce the outline only: section headings with a few bullet points under each. Bullets, never paragraphs, and never any of the finished writing.',
  draft: 'Write the complete piece, following the outline and drawing on the research. Engaging, well-structured, and finished — a real ending, not a stop mid-section.',
  edit: 'Return the full edited piece: fix grammar, tighten flow, strengthen arguments, add transitions, sharpen clarity. Improve what is there — do not add new sections or pad it out. Keep it roughly the same length as the draft.',
  polish: 'Polish the edited piece supplied below and return it complete. Improve it in place: sharpen the opening, tighten the prose, smooth transitions, strengthen the conclusion, hold a consistent professional tone. Preserve its structure, facts and substance — do not rewrite from scratch, do not restart from the topic, and do not make it longer.',
}

const STEP_LABELS: Record<StepId, string> = {
  research: 'Research',
  outline: 'Outline',
  draft: 'Draft',
  edit: 'Edit',
  polish: 'Polish',
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text
}

function buildUserMessage(
  step: StepId,
  topic: string,
  contentType: string,
  context: Partial<Record<StepId, string>>,
): string {
  const sections = STEP_INPUTS[step]
    .map(input => {
      const content = context[input]?.trim()
      if (!content) return ''
      return `## ${STEP_LABELS[input]}\n${clip(content, MAX_CONTEXT_CHARS)}`
    })
    .filter(Boolean)

  if (sections.length === 0) {
    return `Create a ${contentType} about: ${topic}`
  }

  return `${sections.join('\n\n')}\n\nUsing the material above, ${step} the ${contentType} about: ${topic}`
}

interface StepResult {
  content: string
  finishReason: string | null
  servedModel: string | null
}

async function streamStep(
  provider: ProviderConfig,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<StepResult> {
  const response = await fetch(provider.url, {
    method: 'POST',
    signal,
    headers: {
      'Authorization': `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': SITE_URL,
      'X-Title': APP_TITLE,
    },
    body: JSON.stringify({
      model: provider.model,
      ...generationOptions(provider, maxTokens),
      // The browser still receives bounded SSE stage events below. The
      // upstream call is deliberately non-streaming because some reasoning
      // providers spend the stream budget on hidden frames before emitting
      // usable content, while the same bounded request returns a clean stop.
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    console.error(`OpenRouter upstream error ${response.status}: ${errText.slice(0, 500)}`)
    const friendly =
      response.status === 402 ? 'The AI service is temporarily unavailable. Please try again later.'
      : response.status === 429 ? 'The AI service is busy right now. Please retry in a moment.'
      : 'The AI service returned an error. Please retry.'
    throw new UserFacingError(friendly)
  }

  const body = response.body
  if (!body) {
    throw new Error('Empty response body from upstream')
  }
  const parsed = await response.json() as {
    model?: string
    choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>
  }
  const choice = parsed.choices?.[0]
  const content = typeof choice?.message?.content === 'string' ? choice.message.content : ''
  if (content) onChunk(content)
  return {
    content,
    finishReason: choice?.finish_reason ?? null,
    servedModel: typeof parsed.model === 'string' ? parsed.model : null,
  }
}

interface RequestBody {
  topic?: string
  contentType?: string
  step?: string
  context?: Partial<Record<StepId, string>>
}

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const providers = getProviders(process.env.OPENROUTER_MODEL || DEFAULT_MODEL)
  if (providers.length === 0) {
    return new Response(JSON.stringify({ error: 'No server-side AI provider configured' }), { status: 500, headers: jsonHeaders })
  }

  let body: RequestBody
  try {
    body = await req.json() as RequestBody
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: jsonHeaders })
  }

  const topic = (body.topic ?? '').trim().slice(0, MAX_TOPIC_CHARS)
  const contentType = (body.contentType ?? '').trim() || DEFAULT_CONTENT_TYPE
  const step = body.step as StepId | undefined
  const context = body.context ?? {}

  if (!topic) {
    return new Response(JSON.stringify({ error: 'Topic required' }), { status: 400, headers: jsonHeaders })
  }

  if (!step || !STEPS.includes(step)) {
    return new Response(JSON.stringify({ error: `Unknown step. Expected one of: ${STEPS.join(', ')}` }), { status: 400, headers: jsonHeaders })
  }

  const missing = STEP_INPUTS[step].filter(input => !context[input]?.trim())
  if (missing.length > 0) {
    return new Response(JSON.stringify({ error: `Step '${step}' requires prior output: ${missing.join(', ')}` }), { status: 400, headers: jsonHeaders })
  }

  const encoder = new TextEncoder()
  const upstream = new AbortController()
  const abortUpstream = () => upstream.abort()
  req.signal.addEventListener('abort', abortUpstream)

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const send = (data: Record<string, unknown>) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }
      const finish = () => {
        if (closed) return
        closed = true
        try {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch { /* already torn down by the client disconnecting */ }
      }

      send({ type: 'step_start', step })

      const systemPrompt = [
        `You are an expert content creator. The user wants a ${contentType} about: "${topic}".`,
        `Current step: ${step.toUpperCase()}. ${STEP_PROMPTS[step]}`,
        `Keep this response to roughly ${STEP_WORD_BUDGETS[step]} words, and finish inside that budget.`,
        'Output only the content for this step — no preamble, no commentary on what you are doing. Stop as soon as the requested content is complete; never exceed the word budget.',
      ].join(' ')
      const userMessage = buildUserMessage(step, topic, contentType, context)
      let timedOut = false
      const stepTimer = setTimeout(() => {
        timedOut = true
        upstream.abort()
      }, STEP_TIMEOUT_MS)

      try {
        let result: StepResult | null = null
        let selectedProvider: ProviderConfig = providers[0]
        let lastError: unknown = null

        for (const candidate of providers) {
          if (upstream.signal.aborted) break
          const candidateController = new AbortController()
          const abortCandidate = () => candidateController.abort()
          upstream.signal.addEventListener('abort', abortCandidate)
          const candidateTimer = setTimeout(() => candidateController.abort(), MODEL_TIMEOUT_MS)
          try {
            const candidateResult = await streamStep(
              candidate,
              systemPrompt,
              userMessage,
              STEP_MAX_TOKENS[step],
              () => { /* emitted after a complete provider response */ },
              candidateController.signal,
            )
            if (candidateResult.content.trim() && candidateResult.finishReason !== 'length') {
              result = candidateResult
              selectedProvider = candidate
              break
            }
          } catch (err) {
            lastError = err
          } finally {
            clearTimeout(candidateTimer)
            upstream.signal.removeEventListener('abort', abortCandidate)
          }
        }

        if (timedOut) {
          send({ type: 'error', step, content: `The ${step} step timed out before it finished. Please retry.`, friendly: true })
        } else if (upstream.signal.aborted) {
          closed = true
          try { controller.close() } catch { /* client already gone */ }
          return
        }

        if (!result || !result.content.trim()) {
          if (lastError instanceof UserFacingError) {
            send({ type: 'error', step, content: lastError.message, friendly: true })
          } else {
            send({ type: 'error', step, content: 'The AI service returned no usable content for this step. Please retry.', friendly: true })
          }
        } else {
          send({ type: 'step_chunk', step, content: result.content })
          send({
            type: 'step_complete',
            step,
            content: result.content,
            truncated: false,
            served_model: result.servedModel ?? selectedProvider.model,
            served_provider: selectedProvider.name,
          })
        }
      } catch (err) {
        if (timedOut) {
          send({ type: 'error', step, content: `The ${step} step timed out before it finished. Please retry.`, friendly: true })
        } else if (!upstream.signal.aborted) {
          if (err instanceof UserFacingError) {
            send({ type: 'error', step, content: err.message, friendly: true })
          } else {
            console.error(`Step '${step}' failed:`, err)
            send({
              type: 'error',
              step,
              content: 'Something went wrong generating this step. Please retry.',
              friendly: true,
            })
          }
        }
      } finally {
        clearTimeout(stepTimer)
        req.signal.removeEventListener('abort', abortUpstream)
        finish()
      }
    },
    cancel() {
      upstream.abort()
    },
  })

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

export const config = { path: '/api/ai' }
