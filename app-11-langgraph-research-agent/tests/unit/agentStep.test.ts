import { describe, expect, it } from 'vitest'
import { agentStep, crossHostCorroboration, pageHost, type NodeContext } from '../../netlify/shared/graph/nodes'
import type { ResearchValues } from '../../netlify/shared/graph/state'
import type { ChatFn } from '../../netlify/shared/openrouter'
import type { WebTools } from '../../netlify/shared/websearch'
import type { WikiTools } from '../../netlify/shared/wikipedia'

// The corroborating read. When a run with web search on would draft from web pages that all come from one
// host, the graph asks for a page from a different host instead of trusting them: two pages from one host
// are one source. These tests call agentStep directly, with a scripted reply that asks for no tool, so
// only the branch that picks the route after a stop runs.

const WEB_PAGE = {
  n: 1,
  title: 'netlify/cli releases',
  url: 'https://github.com/netlify/cli/releases',
  extract: 'v27.12.1 is the newest release.',
}

const SAME_HOST_PAGE = {
  n: 2,
  title: 'netlify/cli changelog',
  url: 'https://github.com/netlify/cli/blob/main/CHANGELOG.md',
  extract: 'v27.12.1 was released.',
}

const OTHER_HOST_PAGE = {
  n: 2,
  title: 'netlify/cli on npm',
  url: 'https://www.npmjs.com/package/netlify-cli',
  extract: '27.12.2 is the latest version.',
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
    corroborateAtRound: 0,
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
    const out = await agentStep(stateWith({ evidence: [WEB_PAGE], toolRounds: 1 }), context())

    expect(out.route).toEqual({ to: 'agent', label: 'agent (corroborating read)' })
    expect(out.update.corroborateAtRound).toBe(1)
    expect(out.update.messages).toEqual([{ role: 'user', content: expect.stringContaining('one more page') }])
    expect(out.detail).toContain('corroborating')
  })

  it('does not ask again when the agent stopped without reading a page since the last ask', async () => {
    const out = await agentStep(stateWith({ evidence: [WEB_PAGE], toolRounds: 1, corroborateAtRound: 1 }), context())

    expect(out.route).toEqual({ to: 'draft', label: 'draft (no more searches)' })
    expect(out.update.corroborateAtRound).toBeUndefined()
  })

  it('asks again when the second page read is from the same host as the first', async () => {
    const out = await agentStep(
      stateWith({ evidence: [WEB_PAGE, SAME_HOST_PAGE], toolRounds: 2, corroborateAtRound: 1 }),
      context(),
    )

    expect(out.route).toEqual({ to: 'agent', label: 'agent (corroborating read)' })
    expect(out.update.corroborateAtRound).toBe(2)
    expect(out.detail).toContain('one host only')
  })

  it('stops asking once a page from a different host has been read', async () => {
    const out = await agentStep(
      stateWith({ evidence: [WEB_PAGE, OTHER_HOST_PAGE], toolRounds: 2, corroborateAtRound: 1 }),
      context(),
    )

    expect(out.route).toEqual({ to: 'draft', label: 'draft (no more searches)' })
    expect(out.update.corroborateAtRound).toBeUndefined()
  })

  it('does not ask when the single page is a Wikipedia page', async () => {
    const out = await agentStep(stateWith({ evidence: [WIKI_PAGE], toolRounds: 1 }), context())

    expect(out.route).toEqual({ to: 'draft', label: 'draft (no more searches)' })
  })

  it('does not ask when no web search is configured', async () => {
    const out = await agentStep(stateWith({ evidence: [WEB_PAGE], toolRounds: 1 }), context({ web: null }))

    expect(out.route).toEqual({ to: 'draft', label: 'draft (no more searches)' })
  })
})

describe('host comparison', () => {
  it('strips a leading www. and lowercases the hostname, and has no host for an unreadable URL', () => {
    expect(pageHost('https://www.NPMJS.com/package/npm')).toBe('npmjs.com')
    expect(pageHost('https://github.com/netlify/cli')).toBe('github.com')
    expect(pageHost('not a url')).toBeNull()
  })

  it('counts two pages from one host (www. aside) as one source, and two hosts as corroboration', () => {
    expect(crossHostCorroboration([WEB_PAGE, SAME_HOST_PAGE])).toBe(false)
    expect(crossHostCorroboration([{ ...WEB_PAGE, url: 'https://www.github.com/netlify/cli/releases' }, WEB_PAGE])).toBe(false)
    expect(crossHostCorroboration([WEB_PAGE, OTHER_HOST_PAGE])).toBe(true)
    expect(crossHostCorroboration([WIKI_PAGE, WEB_PAGE])).toBe(true)
  })
})
