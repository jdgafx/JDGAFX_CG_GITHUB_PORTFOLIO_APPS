import { Command } from '@langchain/langgraph'
import { describe, expect, it, vi } from 'vitest'
import { GraphGateSaver } from '../../netlify/shared/blobs-saver'
import { JUDGE_PROMPT } from '../../netlify/shared/duplicate-judge'
import { mergeFound } from '../../netlify/shared/duplicate-rank'
import { SearchError, parseSearch, type SearchFn } from '../../netlify/shared/github-search'
import { buildGraph } from '../../netlify/shared/graph'
import { REPLY_PROMPT } from '../../netlify/shared/nodes'
import { ProviderError } from '../../netlify/shared/openrouter'
import { createMemoryStore } from '../../netlify/shared/store'
import type { DuplicateReport, ReviewPayload } from '../../src/types'
import { fakeChat } from '../helpers/fake-chat'
import { issue } from '../helpers/issues'
import recorded from '../fixtures/vscode-334721.json'

const target = issue({
  repo: 'microsoft/vscode',
  number: 334721,
  title: recorded.issue.title,
  body: recorded.issue.body,
  htmlUrl: 'https://github.com/microsoft/vscode/issues/334721',
})
const results = mergeFound(parseSearch(recorded.strict), parseSearch(recorded.broad))
const searchReturning = (items = results): SearchFn => vi.fn(async () => items)

const Q = 'The compact hamburger menu should open and show File, Edit, Selection, View'
const judge = (verdicts: unknown[]) => JSON.stringify({ verdicts })
const DUPLICATE = { number: 334403, verdict: 'duplicate', reason: 'Same menu, same version, same failure.', issueQuote: Q, candidateQuote: 'The menu (File / Edit / Selection / View / …) opens.' }

const CLASSIFIED_BUG_LOW = { type: 'bug', area: 'menubar', severity: 'low', confidence: 0.9, summary: 'The compact menu does not open.' } as const

async function run(options: { search?: SearchFn; chat?: ReturnType<typeof fakeChat>; remainingMs?: () => number; threadId?: string } = {}) {
  const chat = options.chat ?? fakeChat({ classification: CLASSIFIED_BUG_LOW, judge: judge([DUPLICATE]) })
  const graph = buildGraph({
    chat,
    search: options.search ?? searchReturning(),
    now: () => new Date('2026-10-09T12:00:00Z'),
    remainingMs: options.remainingMs ?? (() => 25_000),
    checkpointer: new GraphGateSaver(createMemoryStore()),
  })
  const config = { configurable: { thread_id: options.threadId ?? 't-dup' } }
  const first = (await graph.invoke({ issue: target }, config)) as { __interrupt__?: Array<{ value: ReviewPayload }> }
  return { graph, chat, config, first, report: (await graph.getState(config)).values.duplicateReport as DuplicateReport | null }
}

describe('the duplicates step', () => {
  it('turns a verified duplicate into a proposal to close it, and pauses for a maintainer even for a low-severity bug', async () => {
    const { first, report } = await run()

    expect(report).toMatchObject({ status: 'checked', confirmed: 334403 })
    expect(report?.candidates[0]).toMatchObject({ number: 334403, judgement: { verdict: 'duplicate', quotesVerified: true } })
    const proposal = first.__interrupt__?.[0].value
    expect(proposal?.triage).toMatchObject({
      requiresHuman: true,
      action: 'close_duplicate',
      duplicateOf: { number: 334403, htmlUrl: 'https://github.com/microsoft/vscode/issues/334403' },
      labels: ['bug', 'area: menubar', 'duplicate'],
    })
    expect(proposal?.triage.reasons[0]).toContain('It looks like a duplicate of #334403')
    expect(proposal?.duplicates?.confirmed).toBe(334403)
  })

  it('judges only the top three, in one model call, with the issues sent as data', async () => {
    const { chat } = await run()
    const calls = chat.mock.calls.filter(([request]) => request.messages[0].content === JUDGE_PROMPT)
    expect(calls).toHaveLength(1)
    const data = JSON.parse(calls[0][0].messages[1].content.split('\n')[2]) as { earlierIssues: Array<{ number: number }> }
    expect(data.earlierIssues.map((c) => c.number)).toEqual([334403, 334776, 332309])
  })

  it('does not confirm a duplicate whose quote is not in the candidate: the claim shows as unverified and the issue is only labelled', async () => {
    const forged = judge([{ ...DUPLICATE, candidateQuote: 'The hamburger menu is broken in exactly the same way' }])
    const { first, report } = await run({ chat: fakeChat({ classification: CLASSIFIED_BUG_LOW, judge: forged }) })

    expect(report?.confirmed).toBeNull()
    expect(report?.candidates[0].judgement).toMatchObject({ verdict: 'unverified', claimed: 'duplicate', quotesVerified: false })
    expect(first.__interrupt__).toBeUndefined()
  })

  it('records related and not verdicts without changing the action', async () => {
    const related = judge([{ ...DUPLICATE, verdict: 'related', reason: 'Same area.' }, { number: 334776, verdict: 'not', reason: 'Different.', issueQuote: '', candidateQuote: '' }])
    const { report } = await run({ chat: fakeChat({ classification: CLASSIFIED_BUG_LOW, judge: related }) })
    expect(report?.confirmed).toBeNull()
    expect(report?.candidates.slice(0, 2).map((c) => c.judgement?.verdict)).toEqual(['related', 'not'])
  })

  it('carries on without a check when GitHub rate limits the search, and says so', async () => {
    const limited: SearchFn = async () => {
      throw new SearchError("GitHub's search limit (10 searches a minute without a token) is used up. Try again in about 42 seconds.", true)
    }
    const { graph, config, report } = await run({ search: limited, chat: fakeChat({ classification: CLASSIFIED_BUG_LOW }) })
    expect(report).toMatchObject({ status: 'unavailable', candidates: [], confirmed: null })
    expect(report?.message).toContain('Try again in about 42 seconds. The triage continues without a duplicate check.')
    const rows = (await graph.getState(config)).values.trace
    expect(rows[1]).toMatchObject({ node: 'duplicates', status: 'failed' })
    expect(rows.at(-1)).toMatchObject({ node: 'reply', status: 'ok' })
  })

  it('shows the ranked candidates without verdicts when the model call fails, and does not stop the run', async () => {
    const chat = fakeChat({ classification: CLASSIFIED_BUG_LOW })
    const base = chat.getMockImplementation()!
    chat.mockImplementation(async (request, signal) => {
      if (request.messages[0].content === JUDGE_PROMPT) throw new ProviderError(502, 'The AI provider sent a reply that could not be read.')
      return base(request, signal)
    })
    const { report, first } = await run({ chat })
    expect(report?.status).toBe('unavailable')
    expect(report?.candidates).toHaveLength(5)
    expect(report?.candidates.every((c) => c.judgement === null)).toBe(true)
    expect(report?.message).toContain('shown without verdicts')
    expect(first.__interrupt__).toBeUndefined()
  })

  it('skips the step, and calls neither GitHub nor the model, when under ten seconds are left', async () => {
    const search = searchReturning()
    const chat = fakeChat({ classification: CLASSIFIED_BUG_LOW })
    const { report } = await run({ search, chat, remainingMs: () => 9_999 })
    expect(report).toMatchObject({ status: 'skipped', candidates: [] })
    expect(search).not.toHaveBeenCalled()
    expect(chat.mock.calls.some(([request]) => request.messages[0].content === JUDGE_PROMPT)).toBe(false)
  })

  it('asks the model nothing when no candidate shares enough rare words', async () => {
    const lone = parseSearch({ items: [[...recorded.strict.items, ...recorded.broad.items].find((item) => item.number === 114949)] })
    const chat = fakeChat({ classification: CLASSIFIED_BUG_LOW })
    const { report } = await run({ search: searchReturning(lone), chat })
    expect(report?.status).toBe('none')
    expect(report?.candidates).toHaveLength(1)
    expect(chat.mock.calls.some(([request]) => request.messages[0].content === JUDGE_PROMPT)).toBe(false)
  })
})

describe('approving a proposal to close as a duplicate', () => {
  async function approved(email?: string) {
    const chat = fakeChat({ classification: CLASSIFIED_BUG_LOW, judge: judge([DUPLICATE]), email })
    const { graph, config } = await run({ chat })
    await graph.invoke(new Command({ resume: { action: 'approve' } }), config)
    return { values: (await graph.getState(config)).values, chat }
  }

  it('keeps the action on approve and tells the reply model the original, with no link and no "closed"', async () => {
    const { values, chat } = await approved('This issue duplicates #334403. Please follow #334403 for updates.')
    expect(values.humanDecision).toEqual({ action: 'approve' })
    const facts = chat.mock.calls.filter(([request]) => request.messages[0].content === REPLY_PROMPT).at(-1)![0].messages[1].content
    expect(facts).toContain('a maintainer approved treating this issue as a duplicate of #334403 in the same repository')
    expect(facts).toContain('Write "#334403" as plain text, not a link.')
    expect(facts).toContain('Do not say anything was closed.')
    expect(values.replyDraft).toEqual({ body: 'This issue duplicates #334403. Please follow #334403 for updates.' })
  })

  it('replaces a draft that does not name the original with fixed wording that does', async () => {
    const { values, } = await approved('Thanks for the report. We will look into it.')
    expect(values.replyDraft).toEqual({
      body: 'Thank you for the report. This issue duplicates #334403, which covers the same problem. Please follow #334403 for updates.',
    })
    expect(values.trace.at(-1).detail).toContain('did not name the original issue #334403')
  })
})
