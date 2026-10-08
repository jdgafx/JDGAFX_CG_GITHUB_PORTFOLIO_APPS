import { z } from 'zod'
import type { Evidence } from '../citations'
import type { ChatMessage, ToolCall, ToolDefinition } from '../openrouter'
import { WikiError, type PageText, type SearchHit, type WikiTools } from '../wikipedia'

/** The two tools as OpenAI-style function definitions, sent with every agent call. */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'wikipedia_search',
      description: 'Search English Wikipedia. Returns up to five page titles with short snippets. It reads no page.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search words, 1 to 120 characters.' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wikipedia_page',
      description: 'Read the first 2,500 characters of one English Wikipedia page. The page then becomes a numbered source.',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string', description: 'The exact page title, as wikipedia_search returned it.' } },
        required: ['title'],
        additionalProperties: false,
      },
    },
  },
]

/** Tool calls beyond this many in one agent reply are dropped, so one reply cannot flood Wikipedia. */
export const MAX_CALLS_PER_REPLY = 3

const SearchArgs = z.object({ query: z.string().trim().min(1).max(120) })
const PageArgs = z.object({ title: z.string().trim().min(1).max(200) })

/** What one tool call produced. `content` is what the model reads, `note` is what the trace shows. */
export interface ToolOutcome {
  call: ToolCall
  ok: boolean
  content: string
  note: string
  /** Set only when a page was read. Numbering happens in `numberSources`. */
  page?: PageText
}

const INVALID_JSON = 'Invalid arguments: send a JSON object.'
const UNKNOWN_TOOL = 'Unknown tool. Use wikipedia_search or wikipedia_page.'

function failure(call: ToolCall, message: string): ToolOutcome {
  return { call, ok: false, content: message, note: message }
}

function lookupError(err: unknown): string {
  return err instanceof WikiError ? err.message : 'The Wikipedia lookup failed.'
}

function formatHits(query: string, hits: SearchHit[]): string {
  if (hits.length === 0) return `No Wikipedia pages matched "${query}". Try different words.`
  return hits.map((hit, i) => `${i + 1}. ${hit.title}${hit.snippet ? `: ${hit.snippet}` : ''}`).join('\n')
}

/**
 * Runs one tool call. A bad argument or a failed lookup returns an outcome with `ok` false
 * and adds no source, and the agent loop continues.
 */
export async function runToolCall(call: ToolCall, wiki: WikiTools, signal: AbortSignal): Promise<ToolOutcome> {
  let args: unknown
  try {
    args = JSON.parse(call.args) as unknown
  } catch {
    return failure(call, INVALID_JSON)
  }

  if (call.name === 'wikipedia_search') {
    const parsed = SearchArgs.safeParse(args)
    if (!parsed.success) {
      return failure(call, 'Invalid arguments: wikipedia_search needs a query of 1 to 120 characters.')
    }
    try {
      const hits = await wiki.search(parsed.data.query, signal)
      return {
        call,
        ok: true,
        content: formatHits(parsed.data.query, hits),
        note: `Search "${parsed.data.query}" returned ${hits.length} title(s).`,
      }
    } catch (err) {
      return failure(call, lookupError(err))
    }
  }

  if (call.name === 'wikipedia_page') {
    const parsed = PageArgs.safeParse(args)
    if (!parsed.success) return failure(call, 'Invalid arguments: wikipedia_page needs a title.')
    try {
      const page = await wiki.page(parsed.data.title, signal)
      return { call, ok: true, content: '', note: `Read "${page.title}".`, page }
    } catch (err) {
      return failure(call, lookupError(err))
    }
  }

  return failure(call, UNKNOWN_TOOL)
}

export interface NumberedBatch {
  added: Evidence[]
  messages: ChatMessage[]
}

/**
 * Numbers the pages read in this batch, in call order. A URL already held keeps its number,
 * so one page never gets two. Every call gets one tool message, because the API needs an
 * answer for each call id.
 */
export function numberSources(outcomes: ToolOutcome[], existing: Evidence[]): NumberedBatch {
  const known = new Map<string, Evidence>()
  for (const item of existing) known.set(item.url, item)
  let next = existing.length + 1
  const added: Evidence[] = []
  const messages: ChatMessage[] = []

  for (const outcome of outcomes) {
    let content = outcome.content
    if (outcome.page) {
      const { title, url, extract } = outcome.page
      const held = known.get(url)
      if (held) {
        content = `Already have this page as source [${held.n}].`
      } else {
        const item: Evidence = { n: next, title, url, extract }
        next += 1
        known.set(url, item)
        added.push(item)
        content = `Source [${item.n}]: ${title}\n${url}\n\n${extract}`
      }
    }
    messages.push({ role: 'tool', tool_call_id: outcome.call.id, content })
  }
  return { added, messages }
}
