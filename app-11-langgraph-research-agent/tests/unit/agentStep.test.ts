import { describe, expect, it } from 'vitest'
import { agentStep, type NodeContext } from '../../netlify/shared/graph/nodes'
import type { ResearchValues } from '../../netlify/shared/graph/state'
import type { ChatFn } from '../../netlify/shared/openrouter'
import type { WebTools } from '../../netlify/shared/websearch'
import type { WikiTools } from '../../netlify/shared/wikipedia'

// The corroborating read. When a run with web search on would draft from a single web page, the graph asks
// once for a second page instead of trusting the first. These tests call agentStep directly, with a scripted
// reply that asks for no tool, so only the branch that picks the route after a stop runs.

const WEB_PAGE = {
  n: 1,
  title: 'netlify/cli releases',
  url: 'https://github.com/netlify/cli/releases',
  extract: 'v27.12.1 is the newest release.',
}

const WIKI_PAGE = {
  n: 1,
  title: "Expo '98",
  url: "https://en.wikipedia.org/wiki/Expo_'98",
  extract: "Expo '98 was a world's fair held in Lisbon in 1998.",
}

/** A full state with the defaults the scenarios do not set. */
function stateWith(over: Partial<ResearchValues>): ResearchValues {
  return {
    question: 'What is the latest version of the Netlify CLI?',
    searchQueries: [],
    messages: [],
    pendingCalls: [],
    toolRounds: 0,
    corroborated: false,
    failedLookups: [],
    evidence: [],
    draftText: '',
    draftTruncated: false,
    draftReviewed: false,
    ending: null,
    critique: null,
    revisions: 0,
    route: null,
    finalAnswer: null,
    trace: [],
    ...over,
  }
}

const web: WebTools = {
  search: async () => [],
  page: async (url) => ({ title: url, url, extract: '' }),
}

const wiki: WikiTools = {
  search: async () => [],
  page: async (title) => ({ title, url: `https://en.wikipedia.org/wiki/${title}`, extract: '' }),
}

/** A context whose reply asks for no tool, with the whole budget still left. */
function context(over: Partial<NodeContext> = {}): NodeContext {
  const chat: ChatFn = async () => ({
    text: 'I have what I need.',
    toolCalls: [],
    finishReason: 'stop',
    servedModel: null,
    usage: {},
  })
  return { chat, wiki, web, signal: new AbortController().signal, now: () => 0, deadline: 100_000, ...over }
}

describe('agentStep: the corroborating read', () => {
  it('asks for one more page when a single web page is the only evidence and web search is on', async () => {
    const out = await agentStep(stateWith({ evidence: [WEB_PAGE] }), context())

    expect(out.route).toEqual({ to: 'agent', label: 'agent (corroborating read)' })
    expect(out.update.corroborated).toBe(true)
    expect(out.update.messages).toEqual([{ role: 'user', content: expect.stringContaining('one more page') }])
    expect(out.detail).toContain('corroborating')
  })

  it('does not ask a second time: once corroborated, the stop goes to the draft', async () => {
    const out = await agentStep(stateWith({ evidence: [WEB_PAGE], corroborated: true }), context())

    expect(out.route).toEqual({ to: 'draft', label: 'draft (no more searches)' })
    expect(out.update.corroborated).toBeUndefined()
  })

  it('does not ask when the single page is a Wikipedia page', async () => {
    const out = await agentStep(stateWith({ evidence: [WIKI_PAGE] }), context())

    expect(out.route).toEqual({ to: 'draft', label: 'draft (no more searches)' })
  })

  it('does not ask when no web search is configured', async () => {
    const out = await agentStep(stateWith({ evidence: [WEB_PAGE] }), context({ web: null }))

    expect(out.route).toEqual({ to: 'draft', label: 'draft (no more searches)' })
  })
})
