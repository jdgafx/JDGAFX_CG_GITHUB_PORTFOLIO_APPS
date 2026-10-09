import { describe, expect, it } from 'vitest'
import { rewindFor, verifyToken, type Snapshot } from '../../netlify/shared/checkpoint'
import type { CheckpointOffer, Frame, NodeEndFrame, ResultFrame } from '../../netlify/shared/events'
import { resumeResearch, runResearch } from '../../netlify/shared/graph/stream'
import type { ChatFn, ChatReply, ChatRequest, ToolCall } from '../../netlify/shared/openrouter'
import type { PageText, WikiTools } from '../../netlify/shared/wikipedia'
import { roleOf } from '../helpers/roles'

// The graph runs for real, with LangGraph's own checkpointer and updateState. Only the model and Wikipedia are replaced.

const SECRET = 'test-only-secret'
const QUESTION = 'In what year did Lisbon host a World Exposition, and what was its theme?'
const PAGE: PageText = {
  title: "Expo '98",
  url: "https://en.wikipedia.org/wiki/Expo_'98",
  extract: "Expo '98 was a world's fair held in Lisbon, Portugal, in 1998. Its theme was The Oceans: A Heritage for the Future.",
}
const FIRST = 'Lisbon hosted Expo \'98 in 1998 [1].'
const SECOND = 'Lisbon hosted Expo \'98 in 1998 [1]. The theme was "The Oceans: A Heritage for the Future" [1].'
const wiki: WikiTools = { search: async () => [{ title: "Expo '98", snippet: 'x' }], page: async () => PAGE }
const readPage: ToolCall = { id: 'c1', name: 'wikipedia_page', args: JSON.stringify({ title: "Expo '98" }) }

/** Answers by node, from queues, and records every request. */
function chatFrom(queues: { agent?: ToolCall[][]; draft: string[]; critic: string[] }) {
  const calls: ChatRequest[] = []
  const agent = [...(queues.agent ?? [[readPage], []])]
  const draft = [...queues.draft]
  const critic = [...queues.critic]
  const chat: ChatFn = async (request) => {
    calls.push(request)
    const role = roleOf(request)
    const base = { finishReason: 'stop', servedModel: request.model, usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 } }
    const text = role === 'plan' ? '{"queries": ["Expo 98 Lisbon"]}' : role === 'critic' ? (critic.shift() ?? '') : role === 'draft' ? (draft.shift() ?? '') : ''
    return { ...base, text, toolCalls: role === 'agent' ? (agent.shift() ?? []) : [] } satisfies ChatReply
  }
  return { chat, calls }
}

const noSignal = () => new AbortController().signal

async function firstRun() {
  const model = chatFrom({ draft: [FIRST], critic: ['{"verdict": "accept", "issues": []}'] })
  const frames: Frame[] = []
  await runResearch(QUESTION, { chat: model.chat, wiki, signal: noSignal(), secret: SECRET }, (f) => frames.push(f))
  const offers = frames.find((f) => f.type === 'checkpoints')
  return { frames, offers: offers?.type === 'checkpoints' ? offers.items : [], calls: model.calls }
}

async function resume(offer: CheckpointOffer, edit: unknown, queues: Parameters<typeof chatFrom>[0]) {
  const snapshot = verifyToken(offer.token, SECRET, Date.now()) as Snapshot
  const rewind = rewindFor(snapshot, edit)
  if (!rewind.ok) throw new Error(rewind.message)
  const model = chatFrom(queues)
  const frames: Frame[] = []
  await resumeResearch(snapshot, rewind.value, { chat: model.chat, wiki, signal: noSignal() }, (f) => frames.push(f))
  return {
    frames,
    calls: model.calls,
    ends: frames.filter((f): f is NodeEndFrame => f.type === 'node_end'),
    started: frames.flatMap((f) => (f.type === 'node_start' ? [f.node] : [])),
    result: frames.find((f): f is ResultFrame => f.type === 'result'),
  }
}

describe('checkpoints offered by a finished run', () => {
  it('offers the plan and the critic, each signed, and nothing else', async () => {
    const { offers, frames } = await firstRun()
    expect(offers.map((o) => `${o.kind}:${o.visit}`)).toEqual(['plan:1', 'critic:1'])
    expect(offers[0]?.queries).toEqual(['Expo 98 Lisbon'])
    expect(offers[1]).toMatchObject({ draft: FIRST, sources: ["Expo '98"] })
    expect(frames.at(-1)?.type).toBe('checkpoints')
    expect(frames.some((f) => f.type === 'result')).toBe(true)
  })

  it('offers none without a secret', async () => {
    const model = chatFrom({ draft: [FIRST], critic: ['{"verdict": "accept", "issues": []}'] })
    const frames: Frame[] = []
    await runResearch(QUESTION, { chat: model.chat, wiki, signal: noSignal() }, (f) => frames.push(f))
    expect(frames.some((f) => f.type === 'checkpoints')).toBe(false)
  })
})

describe('resuming from the plan', () => {
  it('skips the plan call, searches with the edited queries, and runs every later step again', async () => {
    const { offers } = await firstRun()
    const out = await resume(offers[0] as CheckpointOffer, { queries: ['Expo 98 theme', 'Lisbon 1998 fair'] }, {
      draft: [SECOND],
      critic: ['{"verdict": "accept", "issues": []}'],
    })

    expect(out.started).toEqual(['agent', 'tools', 'agent', 'draft', 'critic', 'final'])
    expect(out.calls.some((call) => roleOf(call) === 'plan')).toBe(false)
    const agentIntro = out.calls.find((call) => roleOf(call) === 'agent')?.messages.at(-1)
    expect(agentIntro).toMatchObject({ role: 'user' })
    expect(agentIntro?.content).toContain('"Expo 98 theme", "Lisbon 1998 fair"')
    // The plan row is the visitor's; it holds no model, tokens or cost.
    expect(out.ends[0]).toMatchObject({ node: 'plan', edited: true, reused: false, detail: 'Searches set by you: Expo 98 theme; Lisbon 1998 fair' })
    expect(out.ends[0]?.model).toBeUndefined()
    expect(out.result).toMatchObject({ answer: SECOND, fork: { kind: 'plan', visit: 1, reused: 0, rerun: 6 } })
    // Totals cover the steps that ran again: agent, agent, draft, critic.
    expect(out.result?.totals.tokens).toBe(4 * 140)
  })
})

describe('resuming from the critic', () => {
  it('reuses everything before the critic, sends the draft back with the note, and reviews the new draft', async () => {
    const { offers } = await firstRun()
    const note = 'Also state the theme of the exposition.'
    const out = await resume(offers[1] as CheckpointOffer, { notes: note }, {
      draft: [SECOND],
      critic: ['{"verdict": "accept", "issues": []}'],
    })

    expect(out.started).toEqual(['draft', 'critic', 'final'])
    expect(out.ends.filter((e) => e.reused).map((e) => e.node)).toEqual(['plan', 'agent', 'tools', 'agent', 'draft'])
    // The reused rows keep the original run's own times.
    expect(out.ends.filter((e) => e.reused).every((e) => e.ms >= 0 && e.model !== undefined || e.node === 'tools')).toBe(true)
    expect(out.ends.find((e) => e.edited)).toMatchObject({ node: 'critic', visit: 1, ms: 0 })
    expect(out.ends.filter((e) => !e.reused && !e.edited).map((e) => `${e.node}:${e.visit}`)).toEqual(['draft:2', 'critic:2', 'final:1'])
    expect(out.result).toMatchObject({ answer: SECOND, revisions: 1, fork: { kind: 'critic', visit: 1, reused: 5, rerun: 3 } })
    expect(out.result?.totals.tokens).toBe(2 * 140)

    // The note reaches the model in a user message and never in a system prompt.
    const draftRequest = out.calls.find((call) => roleOf(call) === 'draft')
    expect(draftRequest?.messages.filter((m) => m.content?.includes(note)).map((m) => m.role)).toEqual(['user'])
    expect(draftRequest?.messages.some((m) => m.role === 'system' && m.content?.includes(note))).toBe(false)
    expect(out.calls.map(roleOf)).toEqual(['draft', 'critic'])
  })
})
