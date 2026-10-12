import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RunBudget } from '../../netlify/shared/budget'
import { ProviderError } from '../../netlify/shared/errors'
import { citedPointIds, computeCoverage, pointIdsOf } from '../../netlify/shared/coverage'
import { mergeFindings } from '../../netlify/shared/merge'
import { ATTRIBUTE_CALL_TIMEOUT_MS, CHECK_BUDGET_MARGIN_MS, CHECK_CALL_TIMEOUT_MS, MIN_ATTRIBUTE_BUDGET_MS, MIN_CHECK_BUDGET_MS, MODEL } from '../../netlify/shared/models'
import type { ChatFn, ChatReply, ChatRequest } from '../../netlify/shared/openrouter'
import { parseImportant, parseStated, parseSummary } from '../../netlify/shared/parse'
import { attributeMessages, checkMessages, synthesizeMessages } from '../../netlify/shared/prompts'
import { ResultCard } from '../../src/components/ResultCard'
import { pointsHeadline, reviewLine, uncheckedNote, unusedPoints } from '../../src/lib/coverage-text'
import { initialView } from '../../src/lib/view'
import type { Finding, Frame, Merged, RunResult, Summary } from '../../src/types/frames'
import { roleOf } from '../helpers/roles'
import { FixedBudget, runSplit } from '../helpers/split'

interface Fixture {
  chunks: Array<{ chunk: number; points: string[] }>
  summary: { overview: string; sections: Array<{ heading: string; points: Array<{ text: string; chunks: number[] }> }> }
  stated: Record<string, string[]>
}

/** SP2 8adcac0 r3-a: the real extract output and summary of the run whose summary dropped "invented in the late 19th century". */
const R3A = JSON.parse(readFileSync('tests/fixtures/r3-a-rubber-duck.json', 'utf8')) as Fixture
const CHUNK_IDS = R3A.chunks.map((c) => c.chunk)

const finding = (chunkId: number, points: string[]): Finding => ({ chunkId, points, entities: [], model: null, usage: null })
const r3aMerged = (): Merged => mergeFindings(R3A.chunks.map((c) => finding(c.chunk, c.points)))
const r3aSentences = (): string[] => R3A.summary.sections.flatMap((s) => s.points.map((p) => p.text))

/** The fixture summary as the check leaves it: each sentence with the key point ids it states. */
const r3aChecked = (): Summary => {
  const parsed = parseSummary(JSON.stringify(R3A.summary), CHUNK_IDS)
  if (!parsed) throw new Error('fixture summary unreadable')
  let n = 0
  return { ...parsed, sections: parsed.sections.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p, points: R3A.stated[String((n += 1))] ?? [] })) })) }
}

describe('every extracted key point has an id, assigned by code after the extract calls', () => {
  it('numbers the points of each chunk from 1, and keeps the ids of a chunk when a repeated text is dropped', () => {
    const merged = mergeFindings([finding(2, ['B one.', 'b ONE.', 'B two.']), finding(1, ['A one.'])])

    expect(merged.byChunk.map((c) => c.points)).toEqual([
      [{ id: '1.1', text: 'A one.' }],
      [
        { id: '2.1', text: 'B one.' },
        { id: '2.2', text: 'B two.' },
      ],
    ])
  })

  it('reads the real r3-a extract output as 37 points whose point 1.2 is the invention date', () => {
    const merged = r3aMerged()

    expect(pointIdsOf(merged)).toHaveLength(37)
    expect(merged.byChunk[0]?.points[1]).toEqual({ id: '1.2', text: 'Rubber ducks were invented in the late 19th century, when rubber became easier to shape.' })
  })
})

describe('a point is used only when a sentence is found to state it', () => {
  it('lists r3-a point 1.2 as not used although every chunk is cited, and the headline never claims everything is used', () => {
    const merged = r3aMerged()
    const summary = r3aChecked()
    const coverage = computeCoverage({
      chunkIds: CHUNK_IDS,
      withPoints: new Set(CHUNK_IDS),
      cited: new Set(CHUNK_IDS),
      pointIds: pointIdsOf(merged),
      citedPoints: citedPointIds(summary, pointIdsOf(merged)),
      unchecked: [],
    })

    // Every chunk is cited, which is exactly why "7 of 7 chunks covered" was wrong.
    expect(coverage.missing).toEqual([])
    expect(coverage.uncitedPoints).toContain('1.2')
    expect(coverage.citedPoints).not.toContain('1.2')
    expect(coverage.citedPoints.length + coverage.uncitedPoints.length).toBe(37)
    const headline = pointsHeadline(coverage)
    expect(headline.allUsed).toBe(false)
    expect(headline.text).toBe(`${coverage.citedPoints.length} of 37 key points used`)
    expect(headline.text).not.toMatch(/all/i)
  })

  it('shows the headline as everything used only when every point is cited', () => {
    expect(pointsHeadline({ citedPoints: ['1.1', '1.2'], uncitedPoints: [] })).toEqual({ text: '2 of 2 key points used', allUsed: true })
    expect(pointsHeadline({ citedPoints: ['1.1'], uncitedPoints: ['1.2'] }).allUsed).toBe(false)
    expect(pointsHeadline({ citedPoints: [], uncitedPoints: [] }).allUsed).toBe(false)
  })

  it('ignores a forged id: one that is no point of the chunk is neither read nor counted', () => {
    const ids = pointIdsOf(r3aMerged())
    // The attribution of chunk 1 names a point of chunk 2, points that do not exist, a sentence that does not exist, and the real 1.2.
    const reply = JSON.stringify({ states: [{ sentence: 1, points: ['2.1', '9.9', '1.99', 'x', 7, '1.2'] }, { sentence: 2, points: ['8.1'] }, { sentence: 40, points: ['1.1'] }] })
    expect(parseStated(reply, 19, ['1.1', '1.2', '1.3', '1.4', '1.5'])).toEqual(new Map([[1, ['1.2']]]))
    // A summary built by hand with a forged id does not count it either.
    const handBuilt: Summary = { overview: '', sections: [{ heading: 'H', points: [{ text: 'T', points: ['9.9', '1.2'], chunks: [9, 1] }] }] }
    expect([...citedPointIds(handBuilt, ids)]).toEqual(['1.2'])
  })

  it('reads a number as an id, because points per chunk are at most 6', () => {
    expect(parseStated(JSON.stringify({ states: [{ sentence: 1, points: [1.2, '1.1'] }] }), 1, ['1.1', '1.2'])).toEqual(new Map([[1, ['1.2', '1.1']]]))
  })
})

describe('the prompts', () => {
  it('has the writer cite chunk numbers and read the key points by chunk, as before', () => {
    const [system, user] = synthesizeMessages(r3aMerged(), CHUNK_IDS, []).map((m) => m.content)

    expect(system).toContain('"chunks": [chunk numbers]')
    expect(system).toContain('Cite every chunk number at least once')
    expect(user).toContain('[chunk 1] A rubber duck is a duck-shaped toy')
  })

  it("gives each attribution call all numbered sentences and only that chunk's key points, with their ids", () => {
    const merged = r3aMerged()
    const [, user] = attributeMessages(r3aSentences(), 2, merged.byChunk[1]!.points).map((m) => m.content)

    expect(user).toContain("1. Hong Kong's Winsome Plastic Works began producing rubber duck toys in 1948")
    expect(user).toContain('19. As of 2012, none of the ducks had been found')
    expect(user).toContain('Key points of chunk 2:')
    for (const p of merged.byChunk[1]!.points) expect(user).toContain(`[${p.id}] ${p.text}`)
    for (const p of merged.byChunk[0]!.points) expect(user).not.toContain(`[${p.id}]`)
  })

  it('gives the review model only the points no sentence states, and no citations', () => {
    const merged = r3aMerged()
    const summary = r3aChecked()
    const used = new Set(citedPointIds(summary, pointIdsOf(merged)))
    const unused = merged.byChunk.flatMap((c) => c.points).filter((p) => !used.has(p.id))
    const [, user] = checkMessages(summary, unused).map((m) => m.content)

    for (const p of unused) expect(user).toContain(`[${p.id}] ${p.text}`)
    for (const id of used) expect(user).not.toContain(`[${id}]`)
    expect(user).toContain(summary.overview)
    expect(user).not.toMatch(/\[chunk/)
  })

  it('reads only unused ids from the review reply', () => {
    expect(parseImportant('{"important": ["1.2", "1.5", "9.9", 3.2, "x"]}', ['1.2', '3.2'])).toEqual(['1.2', '3.2'])
    expect(parseImportant('{"important": []}', ['1.2'])).toEqual([])
    expect(parseImportant('looks fine', ['1.2'])).toBeNull()
  })
})

// --- the pipeline ---------------------------------------------------------------------------

const reply = (text: string): ChatReply => ({
  text,
  finishReason: 'stop',
  servedModel: MODEL,
  usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
})
const lastMessage = (request: ChatRequest): string => request.messages[request.messages.length - 1]?.content ?? ''
const chunkOf = (user: string): number => Number(/^Chunk (\d+) of/.exec(user)?.[1])
const attributedChunk = (user: string): number => Number(/Key points of chunk (\d+):/.exec(user)?.[1])
/** Seven paragraphs of about 1,000 characters make seven chunks. */
const document7 = Array.from({ length: 7 }, (_, n) => Array.from({ length: 120 }, (_, i) => `term${n}w${i}`).join(' ') + '.').join('\n')

/** An analysis as production runs it: request 1 extracts and signs, request 2 writes and checks. `budget` is request 2's. */
async function run(chat: ChatFn, budget?: RunBudget): Promise<{ results: RunResult[]; errors: string[]; frames: Frame[] }> {
  const { frames, results, errors } = await runSplit(document7, chat, budget ? { budgetSecond: budget } : {})
  return { frames, results, errors }
}

type States = Array<{ sentence: number; points: string[] }>

/** What a correct check says about one chunk: the fixture's hand-assigned ids that belong to it. */
const ownStates = (chunk: number): States =>
  Object.entries(R3A.stated).flatMap(([sentence, ids]) => {
    const own = ids.filter((id) => id.startsWith(`${chunk}.`))
    return own.length > 0 ? [{ sentence: Number(sentence), points: own }] : []
  })

/**
 * Extract answers with the fixture points of its chunk, synthesis with the fixture summary, the attribution of each chunk
 * with `states` (the fixture's own ids for that chunk unless the test says otherwise), and the review with `important`.
 */
function r3aChat(important: string[], seen: ChatRequest[] = [], states: (chunk: number) => States = ownStates): ChatFn {
  return async (request) => {
    seen.push(request)
    const role = roleOf(request)
    const user = lastMessage(request)
    if (role === 'extract') return reply(JSON.stringify({ points: R3A.chunks.find((c) => c.chunk === chunkOf(user))?.points ?? [], entities: [] }))
    if (role === 'synthesize') return reply(JSON.stringify(R3A.summary))
    if (role === 'attribute') return reply(JSON.stringify({ states: states(attributedChunk(user)) }))
    return reply(JSON.stringify({ important }))
  }
}

/** A check that finds every point of every chunk stated by the first sentence. */
const allStated = (chunk: number): States => [{ sentence: 1, points: R3A.chunks.find((c) => c.chunk === chunk)!.points.map((_, i) => `${chunk}.${i + 1}`) }]

const calls = (seen: ChatRequest[], role: string): ChatRequest[] => seen.filter((r) => roleOf(r) === role)

describe('point ids flow from the extract calls to the coverage the page shows', () => {
  it('numbers the extracted points, has each chunk checked against the sentences, and counts the stated ones', async () => {
    const seen: ChatRequest[] = []
    const { results, errors } = await run(r3aChat(['1.2'], seen))

    expect(errors).toEqual([])
    const result = results[0]!
    expect(result.keyPoints[0]?.points[1]).toEqual({ id: '1.2', text: R3A.chunks[0]?.points[1] })
    // One attribution call per chunk, each with only that chunk's points.
    const attribution = calls(seen, 'attribute')
    expect(attribution).toHaveLength(7)
    const first = attribution.find((r) => attributedChunk(lastMessage(r)) === 1)!
    expect(lastMessage(first)).toContain('[1.2] Rubber ducks were invented in the late 19th century')
    expect(lastMessage(first)).not.toContain('[2.1]')
    expect(result.coverage.citedPoints).toContain('1.5')
    expect(result.coverage.uncitedPoints).toContain('1.2')
    expect(result.coverage.citedPoints.length + result.coverage.uncitedPoints.length).toBe(37)
    expect(result.coverage.unchecked).toEqual([])
    // Each sentence carries the ids found for it.
    expect(result.summary.sections[0]?.points[0]?.points).toEqual(['1.5'])
    // Chunk coverage, the secondary view, still says every chunk is cited by the writer.
    expect(result.coverage.missing).toEqual([])
    expect(result.retryOutcome).toBe('none')
  })

  it("does not count a point the writer's chunk citation implies: a sentence has to be found to state it (the original bug)", async () => {
    // The first sentences cite chunk 1, yet only two of chunk 1's five points are stated.
    const { results } = await run(r3aChat([]))
    const chunkOne = results[0]!.coverage.uncitedPoints.filter((id) => id.startsWith('1.'))

    expect(results[0]!.summary.sections[0]?.points[0]?.chunks).toEqual([1])
    expect(chunkOne).toEqual(['1.1', '1.2', '1.3'])
  })

  it('ignores ids the attribution names that are not points of the chunk it was asked about', async () => {
    const { results } = await run(
      r3aChat([], [], (chunk) =>
        chunk === 1
          ? [
              { sentence: 1, points: ['1.5', '2.1', '9.9'] },
              { sentence: 2, points: ['1.2', '3.3'] },
            ]
          : ownStates(chunk),
      ),
    )
    const result = results[0]!

    // 2.1, 3.3 and 9.9 were named by chunk 1's call and are not its points, so they are not attached to those sentences.
    expect(result.summary.sections[0]?.points[0]?.points).toEqual(['1.5'])
    expect(result.summary.sections[0]?.points[1]?.points).toEqual(['1.2'])
    expect(result.coverage.citedPoints).toContain('1.2')
    expect(result.coverage.citedPoints).not.toContain('9.9')
  })

  it('sends the review only the uncited ids, shows what it flags among them, and never edits the summary', async () => {
    const seen: ChatRequest[] = []
    // 1.5 is stated and 9.9 does not exist: both are ignored. 1.2 is not stated and is flagged.
    const { results } = await run(r3aChat(['1.2', '1.5', '9.9'], seen))
    const result = results[0]!
    const review = calls(seen, 'check')

    expect(review).toHaveLength(1)
    const prompt = lastMessage(review[0]!)
    for (const id of result.coverage.uncitedPoints) expect(prompt).toContain(`[${id}]`)
    for (const id of result.coverage.citedPoints) expect(prompt).not.toContain(`[${id}]`)
    expect(result.review).toBe('done')
    expect(result.reviewFlags).toEqual(['1.2'])
    expect(unusedPoints(result).find((p) => p.id === '1.2')).toMatchObject({ flagged: true, text: expect.stringContaining('late 19th century') })
    expect(unusedPoints(result).filter((p) => p.flagged)).toHaveLength(1)
    expect(reviewLine(result)).toContain('1.2')
    expect(result.summary.sections.map((s) => s.points.map((p) => p.text))).toEqual(R3A.summary.sections.map((s) => s.points.map((p) => p.text)))
  })

  it('makes no review call when every point is stated', async () => {
    const seen: ChatRequest[] = []
    const { results } = await run(r3aChat([], seen, allStated))

    expect(calls(seen, 'check')).toHaveLength(0)
    expect(results[0]?.review).toBe('not-needed')
    expect(pointsHeadline(results[0]!.coverage)).toEqual({ text: '37 of 37 key points used', allUsed: true })
    expect(unusedPoints(results[0]!)).toEqual([])
  })
})

describe('a chunk whose key points cannot be checked is said so, never counted as used', () => {
  it('lists its points as unused, names the chunk, and still returns the finished summary', async () => {
    const base = r3aChat(['1.2'])
    const chat: ChatFn = async (request, signal) => {
      if (roleOf(request) === 'attribute' && attributedChunk(lastMessage(request)) === 4) throw new ProviderError('timeout')
      if (roleOf(request) === 'attribute' && attributedChunk(lastMessage(request)) === 5) return { ...reply('{"states": []}'), finishReason: 'length' }
      return base(request, signal)
    }
    const { results, errors, frames } = await run(chat)
    const result = results[0]!

    expect(errors).toEqual([])
    expect(result.coverage.unchecked).toEqual([4, 5])
    expect(result.coverage.uncitedPoints).toEqual(expect.arrayContaining(['4.1', '4.2', '5.1', '5.2']))
    expect(uncheckedNote(result.coverage)).toBe('The key points of chunks 4 and 5 could not be checked against the summary, so they are listed as not used.')
    expect(uncheckedNote({ unchecked: [3] })).toContain('chunk 3 ')
    expect(uncheckedNote({ unchecked: [] })).toBeNull()
    const failed = frames.flatMap((f) => (f.type === 'node_end' && f.node === 'check' && f.status === 'failed' && f.chunk !== undefined ? [f.chunk] : []))
    expect(failed.sort()).toEqual([4, 5])
  })
})

describe('the key point check and the review fit what is left of the run budget', () => {
  it.each([
    [20_000, ATTRIBUTE_CALL_TIMEOUT_MS, CHECK_CALL_TIMEOUT_MS],
    [8_000, ATTRIBUTE_CALL_TIMEOUT_MS, 8_000 - CHECK_BUDGET_MARGIN_MS],
    [MIN_ATTRIBUTE_BUDGET_MS, MIN_ATTRIBUTE_BUDGET_MS - CHECK_BUDGET_MARGIN_MS, MIN_ATTRIBUTE_BUDGET_MS - CHECK_BUDGET_MARGIN_MS],
  ])('with %i ms left each attribution call gets %i ms and the review %i ms', async (left, attribution, review) => {
    const seen: ChatRequest[] = []
    const { results } = await run(r3aChat([], seen), new FixedBudget(left))

    expect(calls(seen, 'attribute').map((r) => r.timeoutMs)).toEqual(Array(7).fill(attribution))
    expect(calls(seen, 'check')[0]?.timeoutMs).toBe(review)
    expect(results[0]?.review).toBe('done')
  })

  it('makes no attribution call with too little left, lists every chunk as unchecked, and keeps the finished summary', async () => {
    const seen: ChatRequest[] = []
    const { results, errors } = await run(r3aChat([], seen), new FixedBudget(MIN_ATTRIBUTE_BUDGET_MS - 1))
    const result = results[0]!

    expect(errors).toEqual([])
    expect(calls(seen, 'attribute')).toHaveLength(0)
    expect(result.coverage.unchecked).toEqual(CHUNK_IDS)
    expect(result.coverage.citedPoints).toEqual([])
    expect(result.summary.overview).toBe(R3A.summary.overview)
  })

  it('skips the review with too little left, keeps the finished summary, and says so', async () => {
    const seen: ChatRequest[] = []
    const { results, errors } = await run(r3aChat(['1.2'], seen), new FixedBudget(MIN_CHECK_BUDGET_MS - 1))
    const result = results[0]!

    expect(errors).toEqual([])
    expect(calls(seen, 'check')).toHaveLength(0)
    expect(result.review).toBe('skipped')
    expect(reviewLine(result)).toMatch(/not run|skipped/i)
  })

  it('keeps the finished summary when the review call itself times out', async () => {
    const base = r3aChat([])
    const chat: ChatFn = async (request, signal) => {
      if (roleOf(request) === 'check') throw new ProviderError('timeout')
      return base(request, signal)
    }
    const { results, errors } = await run(chat)

    expect(errors).toEqual([])
    expect(results[0]?.review).toBe('unavailable')
    expect(results[0]?.coverage.uncitedPoints).toContain('1.2')
  })
})

describe('the page claims what the points show', () => {
  const render = (result: RunResult): string => {
    const html = renderToStaticMarkup(createElement(ResultCard, { view: { ...initialView(), phase: 'done', result }, analyzed: document7, onRetry: () => undefined }))
    return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')
  }


  it('leads with the per-point count, lists the unused points under their own heading, and marks the one the review flags', async () => {
    const { results } = await run(r3aChat(['1.2']))
    const text = render(results[0]!)
    const headline = pointsHeadline(results[0]!.coverage).text

    expect(text).toContain(headline)
    expect(text).toContain(`Key points not used in the summary (${results[0]!.coverage.uncitedPoints.length})`)
    expect(text).toContain('Rubber ducks were invented in the late 19th century')
    expect(text).toContain('May be central')
    // Every chunk is cited, so the chunk count is true, but it is no longer the headline and it never says "covered".
    expect(text).toContain('7 of 7 chunks cited')
    expect(text).not.toContain('chunks covered')
    expect(text).not.toContain('No retry needed')
  })

  it('shows no unused list and a full count when every point is used', async () => {
    const { results } = await run(r3aChat([], [], allStated))
    const text = render(results[0]!)

    expect(text).toContain('37 of 37 key points used')
    expect(text).not.toContain('Key points not used')
  })

  it('says which chunks could not be checked', async () => {
    const base = r3aChat([])
    const { results } = await run(async (request, signal) => {
      if (roleOf(request) === 'attribute' && attributedChunk(lastMessage(request)) === 6) throw new ProviderError('timeout')
      return base(request, signal)
    })

    expect(render(results[0]!)).toContain('The key points of chunk 6 could not be checked against the summary, so they are listed as not used.')
  })

  it('words the review line for each state', () => {
    expect(reviewLine({ review: 'not-needed', reviewFlags: [] })).toBeNull()
    expect(reviewLine({ review: 'done', reviewFlags: [] })).toMatch(/none of these central/)
    expect(reviewLine({ review: 'done', reviewFlags: ['1.2', '3.1'] })).toMatch(/points 1\.2 and 3\.1 may be central/)
    expect(reviewLine({ review: 'unavailable', reviewFlags: [] })).toMatch(/None of these were checked/)
  })
})
