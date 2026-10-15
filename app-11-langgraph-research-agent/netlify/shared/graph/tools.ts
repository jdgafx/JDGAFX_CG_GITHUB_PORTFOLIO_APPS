import { z } from 'zod'
import type { Evidence } from '../citations'
import type { ChatMessage, ToolCall, ToolDefinition } from '../openrouter'
import { WebError, type WebTools } from '../websearch'
import { WikiError, type PageText, type SearchHit, type WikiTools } from '../wikipedia'

/** The two Wikipedia tools as OpenAI-style function definitions, sent with every agent call. */
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

/**
 * The two web tools, offered only when a web search key is set. They answer in the same shapes as the
 * Wikipedia pair, so a web page read here becomes a numbered source by the same path, and the answer
 * rules, the citation check and the critic are unchanged.
 */
export const WEB_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the current web, for news and pages Wikipedia does not carry. Returns up to five results with their titles, addresses and a short excerpt. It reads no page.',
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
      name: 'web_page',
      description:
        'Read the text of one web page by its address. The page then becomes a numbered source. Use the address exactly as web_search returned it.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The full page address, as web_search returned it.' },
          title: { type: 'string', description: 'The title web_search showed for that address.' },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
]

/** The tools offered for one run: the web pair joins the Wikipedia pair only when the web search is configured. */
export function toolDefinitions(web: boolean): ToolDefinition[] {
  return web ? [...TOOL_DEFINITIONS, ...WEB_TOOL_DEFINITIONS] : TOOL_DEFINITIONS
}

/** Tool calls beyond this many in one agent reply are dropped, so one reply cannot flood a provider. */
export const MAX_CALLS_PER_REPLY = 3

/** What a tool call reads from: Wikipedia always, the web only when a key is set. */
export interface ToolBox {
  wiki: WikiTools
  web: WebTools | null
}

const SearchArgs = z.object({ query: z.string().trim().min(1).max(120) })
const PageArgs = z.object({ title: z.string().trim().min(1).max(200) })
const WebPageArgs = z.object({ url: z.string().trim().min(1).max(500), title: z.string().trim().min(1).max(200).optional() })

/** What one tool call produced. `content` is what the model reads, `note` is what the trace shows. */
export interface ToolOutcome {
  call: ToolCall
  ok: boolean
  content: string
  note: string
  /** True when the lookup failed because the provider did not answer (unreachable, timed out, an error reply). A missing page is not. */
  unreachable?: boolean
  /** What was asked, e.g. `page "Lisbon"`. Set with `unreachable`, so a note can name the lookups that failed. */
  lookup?: string
  /** Set only when a page was read. Numbering happens in `numberSources`. */
  page?: PageText
}

const INVALID_JSON = 'Invalid arguments: send a JSON object.'
const UNKNOWN_TOOL = 'Unknown tool. Use one of the tools you were given.'

function failure(call: ToolCall, message: string): ToolOutcome {
  return { call, ok: false, content: message, note: message }
}

/** The provider a failed call asked. The message is the provider's own plain wording, or a generic one. */
function lookupError(call: ToolCall, err: unknown, lookup: string, provider: 'Wikipedia' | 'the web search'): ToolOutcome {
  const message =
    err instanceof WikiError || err instanceof WebError ? err.message : `The ${provider} lookup failed.`
  // Only a "no such page" reply (4xx) means the provider answered. Anything else left the lookup unanswered.
  const status = err instanceof WikiError || err instanceof WebError ? err.status : 500
  const unreachable = status >= 500
  return { ...failure(call, message), unreachable, lookup }
}

/** The results as the model reads them. A result that carries its address shows it, so web_page can be given one. */
export function formatHits(provider: string, query: string, hits: SearchHit[]): string {
  if (hits.length === 0) return `No ${provider} matched "${query}". Try different words.`
  return hits
    .map((hit, i) => `${i + 1}. ${hit.title}${hit.url ? ` (${hit.url})` : ''}${hit.snippet ? `: ${hit.snippet}` : ''}`)
    .join('\n')
}

/**
 * Runs one tool call. A bad argument or a failed lookup returns an outcome with `ok` false
 * and adds no source, and the agent loop continues.
 */
export async function runToolCall(call: ToolCall, box: ToolBox, signal: AbortSignal): Promise<ToolOutcome> {
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
      const hits = await box.wiki.search(parsed.data.query, signal)
      return {
        call,
        ok: true,
        content: formatHits('Wikipedia pages', parsed.data.query, hits),
        note: `Search "${parsed.data.query}" returned ${hits.length} title(s).`,
      }
    } catch (err) {
      return lookupError(call, err, `search "${parsed.data.query}"`, 'Wikipedia')
    }
  }

  if (call.name === 'wikipedia_page') {
    const parsed = PageArgs.safeParse(args)
    if (!parsed.success) return failure(call, 'Invalid arguments: wikipedia_page needs a title.')
    try {
      const page = await box.wiki.page(parsed.data.title, signal)
      return { call, ok: true, content: '', note: `Read "${page.title}".`, page }
    } catch (err) {
      return lookupError(call, err, `page "${parsed.data.title}"`, 'Wikipedia')
    }
  }

  // The web tools exist only when a key is set. A call to one without a key is an unknown tool, so the
  // model is never told about a provider the run does not have.
  if (box.web !== null && call.name === 'web_search') {
    const parsed = SearchArgs.safeParse(args)
    if (!parsed.success) {
      return failure(call, 'Invalid arguments: web_search needs a query of 1 to 120 characters.')
    }
    try {
      const hits = await box.web.search(parsed.data.query, signal)
      return {
        call,
        ok: true,
        content: formatHits('web pages', parsed.data.query, hits),
        note: `Web search "${parsed.data.query}" returned ${hits.length} result(s).`,
      }
    } catch (err) {
      return lookupError(call, err, `web search "${parsed.data.query}"`, 'the web search')
    }
  }

  if (box.web !== null && call.name === 'web_page') {
    const parsed = WebPageArgs.safeParse(args)
    if (!parsed.success) return failure(call, 'Invalid arguments: web_page needs a page address.')
    try {
      const { url, title } = parsed.data
      const page = await box.web.page(url, signal)
      return { call, ok: true, content: '', note: `Read "${title ?? page.title}".`, page: { ...page, title: title ?? page.title } }
    } catch (err) {
      return lookupError(call, err, `web page "${parsed.data.url}"`, 'the web search')
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
