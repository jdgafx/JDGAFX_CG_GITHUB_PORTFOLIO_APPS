import { describe, expect, it } from 'vitest'
import type { Frame, NodeEndFrame, ResultFrame } from '../../netlify/shared/events'
import { runResearch } from '../../netlify/shared/graph/stream'
import {
  BUDGET_MESSAGE,
  ProviderError,
  SLOW_MESSAGE,
  type ChatFn,
  type ChatReply,
} from '../../netlify/shared/openrouter'
import type { PageText, WikiTools } from '../../netlify/shared/wikipedia'
import { roleOf, type Role } from '../helpers/roles'

// The time-aware edges, the retry, the critic's verdict routing and the endings of a stopped run.
// The graph runs for real. The model layer is scripted, and the clock is a number the scripted
// model advances, so every time check trips on a known value and no test waits.

const QUESTION = 'In what year did Lisbon host a World Exposition, and what was its theme?'
const PAGE: PageText = {
  title: "Expo '98",
  url: "https://en.wikipedia.org/wiki/Expo_'98",
  extract: "Expo '98 was a world's fair held in Lisbon in 1998.",
}
const DRAFT = "Lisbon hosted Expo '98 in 1998 [1]."

const wiki: WikiTools = {
  search: async () => [{ title: PAGE.title, snippet: 'World fair' }],
  page: async () => PAGE,
}

/** A critic reply asking for a revision, quoting the words of the draft that are wrong. */
const revise = (quote: string, fix: string) => JSON.stringify({ verdict: 'revise', issues: [{ quote, fix }] })
const QUOTE = "Lisbon hosted Expo '98 in 1998"

const readPage = { id: 'call_1', name: 'wikipedia_page', args: JSON.stringify({ title: "Expo '98" }) }

interface Harness {
  /** Replies per role, in order. A function runs instead and may throw. */
  script: Partial<Record<Role, Array<string | ((clock: { now: number }) => string)>>>
  /** Agent replies that ask for the page read, by call number (1-based). Others reply with no tool. */
  toolsOnAgentCall?: number[]
  /** Milliseconds the clock moves on every model call. */
  step?: number
  deadline?: number
  /** Throws this from the nth call of a role on, for `times` calls in a row (default: every call after). */
  failOn?: Partial<Record<Role, { call: number; error: unknown; times?: number }>>
}

async function run(harness: Harness) {
  const clock = { now: 1_000_000 }
  const counts: Record<Role, number> = { plan: 0, agent: 0, draft: 0, critic: 0 }
  const queues = {
    plan: [...(harness.script.plan ?? ['{"queries": ["Expo 98"]}'])],
    agent: [...(harness.script.agent ?? [])],
    draft: [...(harness.script.draft ?? [DRAFT])],
    critic: [...(harness.script.critic ?? ['{"verdict": "accept", "issues": []}'])],
  }
  const chat: ChatFn = async (request) => {
    const role = roleOf(request)
    counts[role] += 1
    const planned = harness.failOn?.[role]
    if (planned && counts[role] >= planned.call && counts[role] < planned.call + (planned.times ?? Infinity)) {
      throw planned.error
    }
    clock.now += harness.step ?? 0
    const next = queues[role].shift()
    const text = typeof next === 'function' ? next(clock) : (next ?? 'Enough.')
    const wantsTools = role === 'agent' && (harness.toolsOnAgentCall ?? []).includes(counts.agent)
    const usage = { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 }
    return {
      text,
      toolCalls: wantsTools ? [readPage] : [],
      finishReason: 'stop',
      servedModel: request.model,
      usage,
    } satisfies ChatReply
  }
  const frames: Frame[] = []
  await runResearch(
    QUESTION,
    {
      chat,
      wiki,
      signal: new AbortController().signal,
      deadline: harness.deadline === undefined ? undefined : clock.now + harness.deadline,
      now: () => clock.now,
    },
    (frame) => frames.push(frame),
  )
  return {
    frames,
    counts,
    path: frames.flatMap((frame) => (frame.type === 'node_start' ? [frame.node] : [])),
    edges: frames.flatMap((frame) => (frame.type === 'edge' ? [frame.label] : [])),
    ends: frames.filter((frame): frame is NodeEndFrame => frame.type === 'node_end'),
    result: frames.find((frame): frame is ResultFrame => frame.type === 'result') ?? null,
    last: frames.at(-1),
  }
}

describe('time-aware edges', () => {
  it('skips a tool round the time left cannot cover, with the reason on the edge and in the trace', async () => {
    // 4.9 s left at the first agent turn: a round needs 5 s (the tools and a draft), so the agent goes to the draft.
    const out = await run({ script: {}, toolsOnAgentCall: [1], step: 0, deadline: 4_900 })
    expect(out.path).toEqual(['plan', 'agent', 'draft', 'critic', 'final'])
    expect(out.edges).toEqual(['draft (out of time)', 'final (accepted)'])
    expect(out.ends.find((end) => end.node === 'agent')?.detail).toBe(
      'Time left 4 s: no more searches. Drafting with what has been read.',
    )
  })

  it('does the same round when the time left covers it', async () => {
    const out = await run({ script: {}, toolsOnAgentCall: [1], step: 0, deadline: 60_000 })
    expect(out.path).toEqual(['plan', 'agent', 'tools', 'agent', 'draft', 'critic', 'final'])
    expect(out.edges).toEqual(['tools (round 1 of 4)', 'draft (no more searches)', 'final (accepted)'])
  })

  it('skips the next agent turn once a page is read and the time left cannot cover a draft and its review', async () => {
    // Each call takes 6 s of a 20 s budget. After plan and agent, 8 s are left: enough for the tools, not for another turn.
    const out = await run({ script: {}, toolsOnAgentCall: [1], step: 6_000, deadline: 20_000 })
    expect(out.path).toEqual(['plan', 'agent', 'tools', 'agent', 'draft', 'critic', 'final'])
    const secondAgent = out.ends.filter((end) => end.node === 'agent')[1]
    expect(secondAgent).toMatchObject({
      status: 'skipped',
      detail: 'Time left 8 s: finishing with the 1 page(s) already read.',
    })
    expect(secondAgent?.model).toBeUndefined()
    expect(out.counts.agent).toBe(1)
  })

  it('skips the review when the time left is under what the critic needs, and labels the answer unreviewed', async () => {
    const out = await run({ script: {}, toolsOnAgentCall: [1], step: 6_000, deadline: 20_000 })
    const criticEnd = out.ends.find((end) => end.node === 'critic')
    expect(criticEnd).toMatchObject({ status: 'skipped', detail: 'Time left 2 s: skipping the review. The draft goes out unreviewed.' })
    expect(out.edges).toEqual(['tools (round 1 of 4)', 'draft (out of time)', 'final (out of time)'])
    expect(out.counts.critic).toBe(0)
    expect(out.result).toMatchObject({
      answer: DRAFT,
      sources: [{ n: 1, title: "Expo '98" }],
      critic: { reviewed: false, notes: 'Unreviewed: the time limit ended the review.' },
      ending: { kind: 'partial', message: 'Unreviewed: the time limit ended the review.' },
    })
  })

  it('goes to final instead of a revision when the time left cannot cover a draft and a review', async () => {
    // 6.5 s a call, 30 s budget: after the critic 4 s are left, a revision needs 5.5 s.
    const out = await run({
      script: { critic: [revise(QUOTE, 'State the theme.')] },
      step: 6_500,
      deadline: 30_000,
    })
    expect(out.edges).toEqual(['draft (no more searches)', 'final (out of time)'])
    expect(out.counts.draft).toBe(1)
    expect(out.result).toMatchObject({
      revisions: 0,
      critic: { verdict: 'revise', reviewed: true, notes: `"${QUOTE}": State the theme.` },
      ending: { kind: 'partial', message: 'The critic asked for changes, but there was no time left for a revision.' },
    })
  })

  it('revises when the time allows it, so the check above is what stopped the revision', async () => {
    const out = await run({
      script: { critic: [revise(QUOTE, 'State the theme.'), '{"verdict": "accept", "issues": []}'] },
      step: 6_500,
      deadline: 120_000,
    })
    expect(out.edges).toEqual(['draft (no more searches)', 'revise (1 of 2)', 'final (accepted)'])
    expect(out.result).toMatchObject({ revisions: 1, ending: { kind: 'complete', message: '' } })
  })
})

describe('the critic verdict routes on its issues', () => {
  it('sends the draft back only when the verdict is revise and an issue is named', async () => {
    const out = await run({
      script: { critic: [revise(QUOTE, 'Cite the theme.'), '{"verdict": "accept", "issues": []}'] },
    })
    expect(out.edges).toEqual(['draft (no more searches)', 'revise (1 of 2)', 'final (accepted)'])
    expect(out.ends.find((end) => end.node === 'critic')?.detail).toBe(`"${QUOTE}": Cite the theme.`)
  })

  const NO_QUOTE = 'The critic asked for changes but quoted no problem from the draft, so the draft is accepted.'

  it('accepts a revise verdict that names no issue, and says why', async () => {
    const out = await run({ script: { critic: ['{"verdict": "revise", "issues": []}'] } })
    expect(out.edges).toEqual(['draft (no more searches)', 'final (accepted)'])
    expect(out.counts.draft).toBe(1)
    expect(out.ends.find((end) => end.node === 'critic')?.detail).toBe(NO_QUOTE)
    expect(out.result?.critic).toMatchObject({ verdict: 'accept', reviewed: true })
  })

  it('accepts a revise verdict whose issue quotes words that are not in the draft or the question', async () => {
    const out = await run({ script: { critic: [revise('The theme was The Oceans and the Rivers', 'Fix the theme.')] } })
    expect(out.edges).toEqual(['draft (no more searches)', 'final (accepted)'])
    expect(out.counts.draft).toBe(1)
    expect(out.ends.find((end) => end.node === 'critic')?.detail).toBe(NO_QUOTE)
  })

  it('accepts a revise verdict whose issues quote nothing at all', async () => {
    const out = await run({ script: { critic: ['{"verdict": "revise", "issues": ["Make it better."]}'] } })
    expect(out.edges).toEqual(['draft (no more searches)', 'final (accepted)'])
    expect(out.ends.find((end) => end.node === 'critic')?.detail).toBe(NO_QUOTE)
  })

  it('sends a draft back on an issue that quotes the question, for a part left unanswered', async () => {
    const out = await run({
      script: { critic: [revise('what was its theme', 'Answer the theme.'), '{"verdict": "accept", "issues": []}'] },
    })
    expect(out.edges).toEqual(['draft (no more searches)', 'revise (1 of 2)', 'final (accepted)'])
  })

  it('accepts an accept verdict even when issues are listed', async () => {
    const out = await run({ script: { critic: ['{"verdict": "accept", "issues": ["Minor wording."]}'] } })
    expect(out.edges).toEqual(['draft (no more searches)', 'final (accepted)'])
    expect(out.result?.critic).toMatchObject({ verdict: 'accept', reviewed: true, notes: 'Minor wording.' })
  })
})

describe('retrying a call that timed out', () => {
  const timeout = new ProviderError(504, SLOW_MESSAGE)

  it('tries the plan call once more when the first times out and the time left allows it', async () => {
    const out = await run({ script: {}, failOn: { plan: { call: 1, error: timeout, times: 1 } }, deadline: 60_000 })
    expect(out.counts.plan).toBe(2)
    expect(out.ends.find((end) => end.node === 'plan')?.detail).toContain('The first call timed out, so it was tried once more.')
    expect(out.result?.ending.kind).toBe('complete')
  })

  it('does not retry when the time left cannot cover the step again and what must follow', async () => {
    const out = await run({ script: {}, failOn: { plan: { call: 1, error: timeout, times: 1 } }, deadline: 9_000 })
    expect(out.counts.plan).toBe(1)
    expect(out.last).toEqual({ type: 'error', message: SLOW_MESSAGE })
  })

  it('does not retry a call the run budget ended', async () => {
    const out = await run({
      script: {},
      failOn: { plan: { call: 1, error: new ProviderError(504, BUDGET_MESSAGE), times: 1 } },
      deadline: 60_000,
    })
    expect(out.counts.plan).toBe(1)
    expect(out.last).toEqual({ type: 'error', message: BUDGET_MESSAGE })
  })

  it('retries only once, so a second timeout ends the step', async () => {
    const out = await run({ script: {}, failOn: { plan: { call: 1, error: timeout } }, deadline: 60_000 })
    expect(out.counts.plan).toBe(2)
    expect(out.last).toEqual({ type: 'error', message: SLOW_MESSAGE })
  })
})

describe('a run that stops keeps what it has', () => {
  const timeout = new ProviderError(504, SLOW_MESSAGE)

  it('shows the first draft as unreviewed when the critic times out', async () => {
    const out = await run({ script: {}, toolsOnAgentCall: [1], failOn: { critic: { call: 1, error: timeout } } })
    expect(out.last).toMatchObject({
      type: 'result',
      answer: DRAFT,
      sources: [{ n: 1, title: "Expo '98", url: PAGE.url }],
      critic: { reviewed: false },
      ending: { kind: 'partial', message: 'Unreviewed: a provider timeout ended the review.' },
    })
    expect(out.ends.find((end) => end.node === 'critic')).toMatchObject({ status: 'failed', detail: SLOW_MESSAGE })
  })

  it('shows the reviewed draft when the revision times out', async () => {
    const out = await run({
      script: { critic: [revise(QUOTE, 'Cite the theme.')] },
      toolsOnAgentCall: [1],
      failOn: { draft: { call: 2, error: new ProviderError(504, BUDGET_MESSAGE) } },
    })
    expect(out.last).toMatchObject({
      type: 'result',
      answer: DRAFT,
      critic: { verdict: 'revise', reviewed: true, notes: `"${QUOTE}": Cite the theme.` },
      ending: {
        kind: 'partial',
        message: 'Reviewed once: the critic asked for changes, but the time limit ended the revision. This is the reviewed draft.',
      },
    })
  })

  it('shows the revised draft as unreviewed when the second review times out', async () => {
    const out = await run({
      script: { draft: [DRAFT, `${DRAFT} The theme was The Oceans.`], critic: [revise(QUOTE, 'Cite the theme.')] },
      toolsOnAgentCall: [1],
      failOn: { critic: { call: 2, error: timeout } },
    })
    expect(out.last).toMatchObject({
      type: 'result',
      answer: `${DRAFT} The theme was The Oceans.`,
      critic: { reviewed: false },
      ending: {
        kind: 'partial',
        message: 'Revised once, then a provider timeout ended the last review. This draft was not reviewed.',
      },
    })
  })

  it('lists the pages read when the stop comes before any draft', async () => {
    const out = await run({ script: {}, toolsOnAgentCall: [1], failOn: { draft: { call: 1, error: timeout } } })
    expect(out.last).toMatchObject({
      type: 'result',
      answer: '',
      sources: [{ n: 1, title: "Expo '98", url: PAGE.url }],
      ending: {
        kind: 'no_answer',
        message: 'No answer was written: a provider timeout ended the run. The agent read 1 page, listed below.',
      },
    })
  })

  it('still reports a plain error when nothing was read and nothing was drafted', async () => {
    const out = await run({ script: {}, failOn: { plan: { call: 1, error: new ProviderError(402, 'The AI provider rejected the key or is out of credit.') } } })
    expect(out.last).toEqual({ type: 'error', message: 'The AI provider rejected the key or is out of credit.' })
  })
})
