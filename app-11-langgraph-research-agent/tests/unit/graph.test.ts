import { describe, expect, it } from 'vitest'
import type { Frame, NodeEndFrame, ResultFrame } from '../../netlify/shared/events'
import { NODE_MODEL } from '../../netlify/shared/models'
import { roleOf } from '../helpers/roles'
import { ProviderError, type ChatFn, type ChatReply, type ChatRequest, type ToolCall } from '../../netlify/shared/openrouter'
import { runResearch } from '../../netlify/shared/graph/stream'
import { WikiError, type PageText, type WikiTools } from '../../netlify/shared/wikipedia'

// The graph runs for real. Only the model layer and Wikipedia are replaced, so no test
// reaches the network. Each test scripts the replies the agent, draft and critic return.

const QUESTION = 'In what year did Lisbon host a World Exposition, and what was its theme?'
const EXPO_URL = "https://en.wikipedia.org/wiki/Expo_'98"
const DRAFT_CITED = 'Lisbon hosted Expo \'98 in 1998 [1]. Its theme was "The Oceans: A Heritage for the Future" [1].'

const PAGES: Record<string, PageText> = {
  "Expo '98": {
    title: "Expo '98",
    url: EXPO_URL,
    extract: "Expo '98 was a world's fair held in Lisbon, Portugal, from 22 May to 30 September 1998. Its theme was The Oceans: A Heritage for the Future.",
  },
  Lisbon: { title: 'Lisbon', url: 'https://en.wikipedia.org/wiki/Lisbon', extract: 'Lisbon is the capital of Portugal.' },
  Portugal: { title: 'Portugal', url: 'https://en.wikipedia.org/wiki/Portugal', extract: 'Portugal is a country in Europe.' },
}

function fakeWiki(): WikiTools {
  return {
    search: async (query) => [{ title: "Expo '98", snippet: `Results for ${query}` }],
    page: async (title) => {
      const page = PAGES[title]
      if (!page) throw new WikiError(404, `No Wikipedia page has the title "${title}".`)
      return page
    },
  }
}

interface AgentStep {
  text?: string
  tools?: ToolCall[]
}

interface Script {
  agent: AgentStep[]
  draft: string[]
  critic: string[]
  plan?: string
  /** The finish reason for every draft reply. "length" marks the draft as cut short. */
  draftFinish?: string
  /** When true, draft replies carry no usage, so their cost cannot be priced. */
  unpricedDraft?: boolean
}

const readPage = (id: string, title: string): ToolCall => ({
  id,
  name: 'wikipedia_page',
  args: JSON.stringify({ title }),
})

const searchFor = (id: string, query: string): ToolCall => ({
  id,
  name: 'wikipedia_search',
  args: JSON.stringify({ query }),
})

/** A chat function that answers from the script in order and records every request. */
function scriptedChat(script: Script) {
  const calls: ChatRequest[] = []
  const agent = [...script.agent]
  const draft = [...script.draft]
  const critic = [...script.critic]
  const take = <T>(queue: T[], name: string): T => {
    const next = queue.shift()
    if (next === undefined) throw new Error(`No scripted ${name} reply is left.`)
    return next
  }

  const chat: ChatFn = async (request) => {
    calls.push(request)
    const usage = { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 }
    const base = { finishReason: 'stop', servedModel: request.model, usage }
    const role = roleOf(request)
    if (role === 'plan') {
      return { ...base, text: script.plan ?? '{"queries": ["Expo 98 Lisbon"]}', toolCalls: [] } satisfies ChatReply
    }
    if (role === 'agent') {
      const step = take(agent, 'agent')
      return { ...base, text: step.text ?? '', toolCalls: step.tools ?? [] } satisfies ChatReply
    }
    if (role === 'critic') {
      return { ...base, text: take(critic, 'critic'), toolCalls: [] } satisfies ChatReply
    }
    return {
      ...base,
      finishReason: script.draftFinish ?? 'stop',
      usage: script.unpricedDraft ? {} : usage,
      text: take(draft, 'draft'),
      toolCalls: [],
    } satisfies ChatReply
  }
  return { chat, calls }
}

async function run(script: Script, wiki: WikiTools = fakeWiki()) {
  const model = scriptedChat(script)
  const frames: Frame[] = []
  await runResearch(QUESTION, { chat: model.chat, wiki, signal: new AbortController().signal }, (frame) =>
    frames.push(frame),
  )
  return {
    frames,
    calls: model.calls,
    path: frames.flatMap((frame) => (frame.type === 'node_start' ? [frame.node] : [])),
    edges: frames.flatMap((frame) => (frame.type === 'edge' ? [frame.label] : [])),
    ends: frames.filter((frame): frame is NodeEndFrame => frame.type === 'node_end'),
    result: frames.find((frame): frame is ResultFrame => frame.type === 'result') ?? null,
    errors: frames.flatMap((frame) => (frame.type === 'error' ? [frame.message] : [])),
  }
}

describe('graph: the path taken', () => {
  it('(a) one tool round, then a draft the critic accepts', async () => {
    const out = await run({
      agent: [{ tools: [readPage('call_1', "Expo '98")] }, { text: 'Enough sources.' }],
      draft: [DRAFT_CITED],
      critic: ['{"verdict": "accept", "notes": "Every claim matches source [1]."}'],
    })

    expect(out.path).toEqual(['plan', 'agent', 'tools', 'agent', 'draft', 'critic', 'final'])
    expect(out.edges).toEqual(['tools (round 1 of 4)', 'draft (no more searches)', 'final (accepted)'])
    expect(out.result).toMatchObject({
      type: 'result',
      answer: DRAFT_CITED,
      sources: [{ n: 1, title: "Expo '98", url: EXPO_URL }],
      evidenceCount: 1,
      toolRounds: 1,
      revisions: 0,
      path: out.path,
      models: [NODE_MODEL],
      critic: { verdict: 'accept', reviewed: true, notes: 'Every claim matches source [1].' },
      truncated: false,
    })
    expect(out.result?.totals.tokens).toBe(5 * 140)
    expect(out.errors).toEqual([])
    // No call sends a temperature, which Haiku 5.5 rejects.
    expect(out.calls.every((call) => !('temperature' in call))).toBe(true)
    // Until a page is read the agent must call a tool. Once one is read it may stop.
    expect(out.calls.filter((call) => call.tools).map((call) => call.tool_choice)).toEqual(['required', 'auto'])
  })

  it('(b) the critic sends the draft back once, and the second draft gets the notes', async () => {
    const improved = 'Lisbon hosted Expo \'98 in 1998 [1]. The theme was "The Oceans: A Heritage for the Future" [1].'
    const out = await run({
      agent: [{ tools: [readPage('call_1', "Expo '98")] }, { text: 'Enough sources.' }],
      draft: [DRAFT_CITED.replace(/ Its theme.*$/, ''), improved],
      critic: [
        '{"verdict": "revise", "issues": [{"quote": "Lisbon hosted Expo \'98 in 1998", "fix": "State the theme, which is in source [1]."}]}',
        '{"verdict": "accept", "issues": []}',
      ],
    })

    expect(out.path).toEqual(['plan', 'agent', 'tools', 'agent', 'draft', 'critic', 'draft', 'critic', 'final'])
    expect(out.edges).toEqual([
      'tools (round 1 of 4)',
      'draft (no more searches)',
      'revise (1 of 2)',
      'final (accepted)',
    ])
    expect(out.result).toMatchObject({ answer: improved, revisions: 1, critic: { verdict: 'accept', reviewed: true } })

    const secondDraft = out.calls.filter((call) => roleOf(call) === 'draft')
    const notesText = secondDraft[1]?.messages.map((message) => message.content).join('\n') ?? ''
    expect(notesText).toContain('"Lisbon hosted Expo \'98 in 1998": State the theme, which is in source [1].')
  })

  it('(c) the tool loop stops at four rounds and evidence is numbered once per page', async () => {
    const out = await run({
      agent: [
        { tools: [readPage('c1', "Expo '98")] },
        { tools: [readPage('c2', 'Lisbon')] },
        { tools: [readPage('c3', "Expo '98")] },
        { tools: [readPage('c4', 'Portugal')] },
        { tools: [readPage('c5', 'Lisbon')] },
      ],
      draft: [DRAFT_CITED],
      critic: ['{"verdict": "accept", "notes": ""}'],
    })

    expect(out.path).toEqual([
      'plan',
      'agent',
      'tools',
      'agent',
      'tools',
      'agent',
      'tools',
      'agent',
      'tools',
      'agent',
      'draft',
      'critic',
      'final',
    ])
    expect(out.edges).toEqual([
      'tools (round 1 of 4)',
      'tools (round 2 of 4)',
      'tools (round 3 of 4)',
      'tools (round 4 of 4)',
      'draft (tool round limit reached)',
      'final (accepted)',
    ])
    expect(out.calls.filter((call) => call.tools !== undefined)).toHaveLength(4)

    const skipped = out.ends.find((end) => end.node === 'agent' && end.visit === 5)
    expect(skipped).toMatchObject({ status: 'skipped' })

    const thirdRound = out.ends.find((end) => end.node === 'tools' && end.visit === 3)
    expect(thirdRound?.detail).toBe('No new source.')

    // Three distinct pages were read. The draft cites only source 1, so only that one is listed.
    expect(out.result).toMatchObject({
      answer: DRAFT_CITED,
      evidenceCount: 3,
      toolRounds: 4,
      sources: [{ n: 1, title: "Expo '98", url: EXPO_URL }],
    })
  })

  it('(d) a failed tool call adds no source and the loop carries on', async () => {
    const out = await run({
      agent: [
        { tools: [readPage('d1', 'Missing Page')] },
        { tools: [searchFor('d2', 'Lisbon')] },
        { text: 'Done.' },
      ],
      draft: ['The sources do not say which year. I could not find a source that answers the question.'],
      critic: ['{"verdict": "accept", "notes": ""}'],
    })

    expect(out.path).toEqual(['plan', 'agent', 'tools', 'agent', 'tools', 'agent', 'draft', 'critic', 'final'])
    expect(out.ends.find((end) => end.node === 'tools' && end.visit === 1)?.detail).toContain(
      'No Wikipedia page has the title "Missing Page".',
    )
    expect(out.result).toMatchObject({ evidenceCount: 0, toolRounds: 2, sources: [] })
  })

  it('(e) the critic cannot force more than two revisions', async () => {
    const out = await run({
      agent: [{ text: 'Enough.' }],
      draft: ['First draft.', 'Second draft.', 'Third draft.'],
      critic: [
        '{"verdict": "revise", "issues": [{"quote": "First draft", "fix": "Add more detail."}]}',
        '{"verdict": "revise", "issues": [{"quote": "Second draft", "fix": "Still missing detail."}]}',
        '{"verdict": "revise", "issues": [{"quote": "Third draft", "fix": "Still not enough."}]}',
      ],
    })

    expect(out.path).toEqual(['plan', 'agent', 'draft', 'critic', 'draft', 'critic', 'draft', 'critic', 'final'])
    expect(out.edges).toEqual([
      'draft (no more searches)',
      'revise (1 of 2)',
      'revise (2 of 2)',
      'final (revision limit reached)',
    ])
    expect(out.result).toMatchObject({
      answer: 'Third draft.',
      revisions: 2,
      critic: { verdict: 'revise', reviewed: true, notes: '"Third draft": Still not enough.' },
    })
  })

  it('(f) an unreadable critic reply goes out unreviewed, and is labelled that way', async () => {
    const out = await run({
      agent: [{ text: 'Enough.' }],
      draft: ['A plain answer [1].'],
      critic: ['Looks good to me.'],
    })

    expect(out.edges).toEqual(['draft (no more searches)', 'final (critic reply unreadable)'])
    expect(out.result?.critic).toEqual({
      verdict: 'accept',
      reviewed: false,
      notes: 'Not reviewed: the critic reply could not be read.',
    })
  })

  it('(g) a provider failure ends the run with the plain message, after the failed node', async () => {
    const frames: Frame[] = []
    const chat: ChatFn = async () => {
      throw new ProviderError(402, 'The AI provider rejected the key or is out of credit.')
    }
    await runResearch(QUESTION, { chat, wiki: fakeWiki(), signal: new AbortController().signal }, (frame) =>
      frames.push(frame),
    )

    const failedPlan = frames.find((frame) => frame.type === 'node_end')
    expect(failedPlan).toMatchObject({ type: 'node_end', node: 'plan', status: 'failed' })
    expect(frames.at(-1)).toEqual({
      type: 'error',
      message: 'The AI provider rejected the key or is out of credit.',
    })
    expect(frames.some((frame) => frame.type === 'result')).toBe(false)
  })

  const idleReply = (text: string): ChatReply => ({
    text,
    toolCalls: [],
    finishReason: 'stop',
    servedModel: null,
    usage: {},
  })

  it('(h) a reply with more than three tool calls runs the first three and records the rest as dropped', async () => {
    const out = await run({
      agent: [
        {
          tools: [
            readPage('h1', "Expo '98"),
            readPage('h2', 'Lisbon'),
            readPage('h3', 'Portugal'),
            readPage('h4', 'Missing A'),
            readPage('h5', 'Missing B'),
          ],
        },
        { text: 'Enough sources.' },
      ],
      draft: [DRAFT_CITED],
      critic: ['{"verdict": "accept", "notes": ""}'],
    })

    expect(out.path).toEqual(['plan', 'agent', 'tools', 'agent', 'draft', 'critic', 'final'])
    expect(out.ends.find((end) => end.node === 'agent' && end.visit === 1)?.detail).toBe(
      'Asked for wikipedia_page, wikipedia_page, wikipedia_page. Dropped 2 beyond the limit of 3.',
    )
    // The second agent call sees only the three calls that ran, each with an answer.
    const secondTurn = out.calls.filter((call) => call.tools !== undefined)[1]?.messages ?? []
    const askedIds = secondTurn.flatMap((message) =>
      message.role === 'assistant' && message.tool_calls ? message.tool_calls.map((call) => call.id) : [],
    )
    expect(askedIds).toEqual(['h1', 'h2', 'h3'])
    expect(secondTurn.filter((message) => message.role === 'tool')).toHaveLength(3)
    expect(out.result).toMatchObject({ evidenceCount: 3, toolRounds: 1 })
  })

  it('(i) a draft that hit its length limit marks the result as truncated', async () => {
    const out = await run({
      agent: [{ text: 'Enough.' }],
      draft: ["Lisbon hosted Expo '98 in 1998."],
      critic: ['{"verdict": "accept", "notes": ""}'],
      draftFinish: 'length',
    })

    expect(out.result).toMatchObject({ answer: "Lisbon hosted Expo '98 in 1998.", truncated: true })
    expect(out.ends.find((end) => end.node === 'draft')?.detail).toBe(
      'The reply hit the token limit and may be cut short.',
    )
  })

  it('(j) a model call with no price is counted, so the total is labelled partial', async () => {
    const out = await run({
      agent: [{ tools: [readPage('j1', "Expo '98")] }, { text: 'Enough sources.' }],
      draft: [DRAFT_CITED],
      critic: ['{"verdict": "accept", "notes": ""}'],
      unpricedDraft: true,
    })

    expect(out.ends.find((end) => end.node === 'draft')?.cost).toBeUndefined()
    // Only the draft call lacks a price. The tool and final rows made no model call, so they are not counted.
    expect(out.result?.totals).toMatchObject({ unpricedRows: 1, costSource: 'estimated' })
    expect(out.result?.totals.cost).toBeGreaterThan(0)
  })

  it('(k) a provider error wrapped in an AggregateError inside the draft reaches the client as the plain message', async () => {
    const chat: ChatFn = async (request) => {
      if (roleOf(request) === 'plan') return idleReply('{"queries": ["Lisbon"]}')
      if (request.tools) return idleReply('Enough.')
      throw new AggregateError(
        [new ProviderError(500, 'The AI provider did not answer in time.')],
        'wrapped by the runtime',
      )
    }
    const frames: Frame[] = []
    await runResearch(QUESTION, { chat, wiki: fakeWiki(), signal: new AbortController().signal }, (frame) =>
      frames.push(frame),
    )

    expect(frames).toContainEqual(
      expect.objectContaining({
        type: 'node_end',
        node: 'draft',
        status: 'failed',
        detail: 'The AI provider did not answer in time.',
      }),
    )
    expect(frames.at(-1)).toEqual({ type: 'error', message: 'The AI provider did not answer in time.' })
    expect(JSON.stringify(frames)).not.toContain('AggregateError')
  })

  it('(l) a provider failure inside the critic node keeps the draft and labels it unreviewed', async () => {
    const chat: ChatFn = async (request) => {
      if (roleOf(request) === 'plan') return idleReply('{"queries": ["Lisbon"]}')
      if (request.tools) return idleReply('Enough.')
      if (roleOf(request) === 'critic') {
        throw new ProviderError(402, 'The AI provider rejected the key or is out of credit.')
      }
      return idleReply('A plain answer.')
    }
    const frames: Frame[] = []
    await runResearch(QUESTION, { chat, wiki: fakeWiki(), signal: new AbortController().signal }, (frame) =>
      frames.push(frame),
    )

    expect(frames).toContainEqual(
      expect.objectContaining({
        type: 'node_end',
        node: 'critic',
        status: 'failed',
        detail: 'The AI provider rejected the key or is out of credit.',
      }),
    )
    expect(frames.at(-1)).toMatchObject({
      type: 'result',
      answer: 'A plain answer.',
      critic: { reviewed: false },
      ending: { kind: 'partial', message: 'Unreviewed: a failed step ended the review.' },
    })
    expect(frames.some((frame) => frame.type === 'error')).toBe(false)
  })
})
