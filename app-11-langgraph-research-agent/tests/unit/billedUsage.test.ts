import { describe, expect, it } from 'vitest'
import type { Frame, NodeEndFrame, ResultFrame } from '../../netlify/shared/events'
import { fixturePriceBook } from '../helpers/priceBook'
import { roleOf } from '../helpers/roles'
import { BUDGET_MESSAGE, ProviderError, SLOW_MESSAGE, UNREACHABLE_MESSAGE, type ChatFn, type ChatReply, type ChatRequest } from '../../netlify/shared/openrouter'
import { runResearch } from '../../netlify/shared/graph/stream'
import type { WikiTools } from '../../netlify/shared/wikipedia'

// C13: a model call the provider billed is never dropped. Every call counts in its own row and in the run totals,
// whatever became of its reply, and a call whose usage never arrived is shown as not reported.

const SERVED = 'anthropic/claude-haiku-5.5'
const OLD = 'anthropic/claude-haiku-4.5'
const QUESTION = 'In what year did Lisbon host a World Exposition?'
const USAGE = { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 }
const CITED = "Lisbon hosted Expo '98 in 1998 [1]."
const wiki: WikiTools = {
  search: async () => [{ title: "Expo '98", snippet: 'x' }],
  page: async (title) => ({ title, url: "https://en.wikipedia.org/wiki/Expo_'98", extract: "Expo '98 was held in Lisbon in 1998." }),
}

type Role = ReturnType<typeof roleOf>
/** What one scripted call does: a reply, or an error to throw. */
type Step = Partial<ChatReply> | Error

function reply(over: Partial<ChatReply>): ChatReply {
  return { text: '', toolCalls: [], finishReason: 'stop', servedModel: SERVED, usage: USAGE, ...over }
}

const READ_PAGE = { id: 'c1', name: 'wikipedia_page', args: JSON.stringify({ title: "Expo '98" }) }

/** Answers each role from its own queue. A role that runs dry gets a plain accepted reply. */
function scripted(queues: Partial<Record<Role, Step[]>>): ChatFn {
  const left = { plan: [...(queues.plan ?? [])], agent: [...(queues.agent ?? [])], draft: [...(queues.draft ?? [])], critic: [...(queues.critic ?? [])] }
  const fallback: Record<Role, ChatReply> = {
    plan: reply({ text: '{"queries": ["Expo 98"]}' }),
    agent: reply({ toolCalls: [READ_PAGE] }),
    draft: reply({ text: CITED }),
    critic: reply({ text: '{"verdict": "accept", "notes": ""}' }),
  }
  return async (request: ChatRequest) => {
    const role = roleOf(request)
    const step = left[role].shift()
    if (step instanceof Error) throw step
    return step ? reply(step) : fallback[role]
  }
}

async function go(queues: Partial<Record<Role, Step[]>>) {
  const frames: Frame[] = []
  await runResearch(
    QUESTION,
    { chat: scripted(queues), wiki, signal: new AbortController().signal, priceBook: Promise.resolve(fixturePriceBook()) },
    (frame) => frames.push(frame),
  )
  const ends = frames.filter((frame): frame is NodeEndFrame => frame.type === 'node_end')
  return {
    ends,
    failed: ends.find((end) => end.status === 'failed'),
    result: frames.find((frame): frame is ResultFrame => frame.type === 'result') ?? null,
    errors: frames.flatMap((frame) => (frame.type === 'error' ? [frame.message] : [])),
  }
}

/** The agent reads one page, then moves on to the draft. */
const READ_THEN_DRAFT: Step[] = [{ toolCalls: [READ_PAGE] }, { text: 'Enough.' }]

describe('C13: billed usage is never dropped', () => {
  it('counts a reply refused for coming from an older model: still refused, but its usage and price are in the row and the totals', async () => {
    const out = await go({ agent: READ_THEN_DRAFT, draft: [{ servedModel: OLD }] })

    expect(out.errors).toEqual([]) // the read page and the earlier calls give a partial result, not a bare error
    expect(out.failed).toMatchObject({ node: 'draft', servedModel: OLD, usage: { total_tokens: 140 }, refused: true, costSource: 'list' })
    expect(out.failed?.cost).toBeGreaterThan(0)
    expect(out.failed?.detail).toContain('nothing from that reply is shown')
    expect(out.result?.totals.refusedCalls).toBe(1)
    // plan + 2 agent + the refused draft = 4 billed calls
    expect(out.result?.totals.tokens).toBe(4 * 140)
    expect(out.result?.totals.unpricedRows).toBe(0)
    expect(out.result?.models).toContain(OLD)
  })

  it('uses the cost OpenRouter reported for a refused call, not the list price, and says so on the row', async () => {
    const out = await go({ agent: READ_THEN_DRAFT, draft: [{ servedModel: OLD, usage: { ...USAGE, cost: 0.0123 } }] })

    expect(out.failed).toMatchObject({ node: 'draft', refused: true, cost: 0.0123, costSource: 'reported' })
    // The other four calls are priced from the list, the refused one from its reported cost.
    expect(out.result?.totals.cost).toBeCloseTo(0.0123 + 3 * 0.00003, 9)
  })

  it('marks only a refused row as refused', async () => {
    const out = await go({ agent: READ_THEN_DRAFT })
    expect(out.ends.every((end) => end.refused === undefined && end.costSource === undefined)).toBe(true)
    expect(out.result?.totals.refusedCalls).toBe(0)
  })

  it('counts an empty draft, which fails the step', async () => {
    const out = await go({ agent: READ_THEN_DRAFT, draft: [{ text: '' }] })

    expect(out.failed).toMatchObject({ node: 'draft', detail: 'The draft came back empty.', usage: { total_tokens: 140 } })
    expect(out.failed?.cost).toBeGreaterThan(0)
    expect(out.result?.ending.kind).toBe('no_answer')
    expect(out.result?.totals.tokens).toBe(4 * 140)
  })

  it('keeps the call of a draft that was cut off', async () => {
    const out = await go({ agent: READ_THEN_DRAFT, draft: [{ text: CITED, finishReason: 'length' }] })
    const draft = out.ends.find((end) => end.node === 'draft')
    expect(draft).toMatchObject({ status: 'ok', usage: { total_tokens: 140 } })
    expect(out.result?.totals.tokens).toBe(5 * 140)
  })

  it('keeps the call of a critic whose reply could not be read', async () => {
    const out = await go({ agent: READ_THEN_DRAFT, critic: [{ text: 'Looks fine.' }] })
    expect(out.ends.find((end) => end.node === 'critic')).toMatchObject({ status: 'ok', usage: { total_tokens: 140 } })
    expect(out.result?.totals.tokens).toBe(5 * 140)
  })

  it('counts a call that failed after a timed-out first attempt as 2 calls not reported, and shows totals', async () => {
    const slow = new ProviderError(504, SLOW_MESSAGE)
    const out = await go({ agent: READ_THEN_DRAFT, draft: [slow, slow] })

    expect(out.failed).toMatchObject({ node: 'draft', unreportedCalls: 2 })
    expect(out.failed?.usage).toBeUndefined()
    expect(out.failed?.model).toBeUndefined()
    expect(out.result?.totals).toMatchObject({ tokens: 3 * 140, unreportedCalls: 2 })
  })

  it('counts the first attempt of a timeout retry as not reported, beside the retry that answered', async () => {
    const out = await go({ plan: [new ProviderError(502, UNREACHABLE_MESSAGE)], agent: READ_THEN_DRAFT })

    const plan = out.ends.find((end) => end.node === 'plan')
    expect(plan).toMatchObject({ status: 'ok', usage: { total_tokens: 140 }, unreportedCalls: 1 })
    expect(out.result?.totals).toMatchObject({ unreportedCalls: 1 })
    expect(out.result?.totals.tokens).toBe(5 * 140)
  })

  it('keeps the unreported first attempt when the retry is refused by the provider', async () => {
    const out = await go({ agent: READ_THEN_DRAFT, draft: [new ProviderError(504, SLOW_MESSAGE), new ProviderError(402, 'The AI provider rejected the key or is out of credit.')] })
    expect(out.failed).toMatchObject({ node: 'draft', unreportedCalls: 1 })
  })

  it('does not call a 4xx refusal unreported: nothing was billed', async () => {
    const out = await go({ plan: [new ProviderError(402, 'The AI provider rejected the key or is out of credit.')] })
    expect(out.failed).toMatchObject({ node: 'plan' })
    expect(out.failed?.unreportedCalls).toBeUndefined()
    expect(out.failed?.usage).toBeUndefined()
  })

  it('counts a call the run budget cut off as not reported', async () => {
    const out = await go({ agent: READ_THEN_DRAFT, draft: [new ProviderError(504, BUDGET_MESSAGE)] })
    expect(out.failed).toMatchObject({ node: 'draft', unreportedCalls: 1 })
    expect(out.result?.totals.unreportedCalls).toBe(1)
  })

  it('leaves a run with no failure and no gaps with nothing unreported', async () => {
    const out = await go({ agent: READ_THEN_DRAFT })
    expect(out.result?.totals).toMatchObject({ tokens: 5 * 140, unpricedRows: 0, unreportedCalls: 0 })
    expect(out.ends.every((end) => end.unreportedCalls === undefined)).toBe(true)
  })
})
