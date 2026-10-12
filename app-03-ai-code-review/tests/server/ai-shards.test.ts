import { describe, expect, it, vi } from 'vitest'
import { makeShardRecord } from '../../netlify/shared/handoff'
import { commentBudget } from '../../netlify/shared/review'
import { SHARD_MAX_TOKENS } from '../../netlify/shared/budget'
import { planShards } from '../../netlify/shared/shards'
import { PLACEHOLDER_KEY, fetchStub, handler, installHooks, keep, mergeHandler, post, readHandler, readPayload, reply, reviewJson, script, sentBody, verdictJson, type Payload } from './harness'

installHooks()

// A file of 450 lines is three shards. Each shard is its own request; a merge joins them; the reads then work as they always did.

const LINES = Array.from({ length: 450 }, (_, i) => (i % 30 === 0 ? `func f${i / 30}() {` : i % 30 === 28 ? '}' : i % 30 === 29 ? '' : `\tstep_${i + 1}()`))
const BIG = { code: LINES.join('\n'), language: 'go' }
const PLAN = planShards(LINES, null, commentBudget(450))
const comment = (line: number) => ({ line, quote: LINES[line - 1].trim(), severity: 'warning', message: `The call on line ${line} ignores the error it returns.`, suggestion: 'Check the error before going on.', issue: true })
/** A comment on a code line inside shard `i`, `k` lines in. */
const inShard = (i: number, k = 3) => comment(PLAN[i].from + k)
type Ticket = { text: string; seal: string }
type MergeReply = Payload & { batches: number[][]; handoff: { id: string; text: string; seals: { 'read-1': string[]; 'read-2': string[] } } | null }

const url = (path: string) => `http://localhost${path}`
const shardRequest = (i: number, of = 3, body: Record<string, unknown> = BIG, ip?: string) => post(body, { url: url(`/api/ai?shard=${i}&of=${of}`), ...(ip ? { ip } : {}) })

/** Runs shard `i` against a stubbed pass 1 that answers `comments`; returns the signed record it gave back. */
async function runShard(i: number, comments: unknown[]): Promise<Ticket> {
  script({ pass1: [reply(reviewJson(comments))] })
  const res = await handler(shardRequest(i))
  expect(res.status).toBe(200)
  return ((await res.json()) as { record: Ticket }).record
}

const mergeRequest = (shards: unknown, body: Record<string, unknown> = BIG) => mergeHandler(post({ ...body, shards }, { url: url('/api/ai/merge') }))

describe('the plan this file is checked against', () => {
  it('is three shards of about 150 lines, each starting on a top-level line after a blank line', () => {
    expect(PLAN).toHaveLength(3)
    for (const s of PLAN.slice(1)) {
      expect(LINES[s.from - 2]).toBe('')
      expect(LINES[s.from - 1]).toMatch(/^func /)
    }
  })
})

describe('a shard request', () => {
  it('reviews only its range: the prompt names it, the whole numbered file goes with it as context, and the reply is capped at the measured rate', async () => {
    script({ pass1: [reply(reviewJson([inShard(1)]))] })
    const res = await handler(shardRequest(1))
    const payload = (await res.json()) as Payload & { shard: number; of: number; record: Ticket }
    expect(res.status).toBe(200)
    expect(payload).toMatchObject({ success: true, stage: 'review', shard: 1, of: 3 })
    expect(payload.record.seal).toMatch(/^[0-9a-f]{64}$/)
    expect(fetchStub).toHaveBeenCalledTimes(1)
    const sent = sentBody(0)
    expect(sent.messages[0].content).toContain(`lines ${PLAN[1].from} to ${PLAN[1].to} only`)
    expect(sent.messages[0].content).toContain('read-only context')
    expect(sent.messages[1].content).toContain('1\t| func f0() {')
    expect(sent.messages[1].content).toContain('450\t| ')
    expect(sent.messages[1].content).toContain(`lines ${PLAN[1].from} to ${PLAN[1].to} only`)
    expect(sent.max_tokens).toBe(SHARD_MAX_TOKENS)
    expect(sent).not.toHaveProperty('reasoning')
  })

  it('names its range on its rows, and records the request check once, on the first shard', async () => {
    script({ pass1: [reply(reviewJson([]))] })
    const first = (await (await handler(shardRequest(0))).json()) as Payload
    script({ pass1: [reply(reviewJson([]))] })
    const second = (await (await handler(shardRequest(1))).json()) as Payload
    expect(first.trace.map((s) => s.name)).toEqual(['Check request', `Build prompt (lines ${PLAN[0].from}-${PLAN[0].to})`, `Pass 1: review (lines ${PLAN[0].from}-${PLAN[0].to})`, `Parse reply (lines ${PLAN[0].from}-${PLAN[0].to})`])
    expect(second.trace.map((s) => s.name)).toEqual([`Build prompt (lines ${PLAN[1].from}-${PLAN[1].to})`, `Pass 1: review (lines ${PLAN[1].from}-${PLAN[1].to})`, `Parse reply (lines ${PLAN[1].from}-${PLAN[1].to})`])
  })

  it.each([
    ['says another number of parts', 2, 0],
    ['names a part past the last', 3, 3],
    ['says one part', 1, 0],
  ])('is refused, with no model call, when it %s', async (_name, of, index) => {
    const res = await handler(post(BIG, { url: url(`/api/ai?shard=${index}&of=${of}`) }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as Payload).error).toBe('This review is made of 3 parts; the request named another.')
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('is refused when it says nothing about parts and the file needs several', async () => {
    expect((await handler(post(BIG))).status).toBe(400)
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('is refused when a small file claims to be in parts', async () => {
    const res = await handler(post({ code: 'x = 1\ny = 2', language: 'python' }, { url: url('/api/ai?shard=0&of=3') }))
    expect(res.status).toBe(400)
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it.each([['length', 'ran out of reply length'], ['content_filter', 'did not finish']])('fails alone when its reply ends with finish_reason %s, and bills it', async (finish, message) => {
    script({ pass1: [reply(reviewJson([inShard(2)]), finish), reply(reviewJson([inShard(2)]), finish)] })
    const res = await handler(shardRequest(2))
    const payload = await readPayload(res)
    expect(res.status).toBe(502)
    expect(payload.error).toContain(message)
    expect((payload as unknown as { record?: unknown }).record).toBeUndefined()
    expect(payload.usage).toMatchObject({ total_tokens: 300 })
    // A shard's rows are its own: they are not padded with the stages of a whole review.
    expect(payload.trace.every((s) => s.status !== 'skipped')).toBe(true)
  })

  it('times out alone at the pass 1 limit, not reported, with a 504', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    fetchStub.mockImplementation((_url, init) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))))
    const pending = handler(shardRequest(1))
    await vi.advanceTimersByTimeAsync(24_000)
    const res = await pending
    const payload = await readPayload(res)
    expect(res.status).toBe(504)
    expect(payload.usage).toBeNull()
    expect((payload as unknown as { unreportedCalls: number }).unreportedCalls).toBe(1)
  })

  it('counts a review once however many shards it has: three shards are one review of the twenty a minute', async () => {
    const ip = '192.0.2.150'
    script({ pass1: Array.from({ length: 70 }, () => reply(reviewJson([]))) })
    for (let review = 0; review < 20; review += 1) for (let i = 0; i < 3; i += 1) expect((await handler(shardRequest(i, 3, BIG, ip))).status).toBe(200)
    // The twenty-first review is refused at its first shard.
    expect((await handler(shardRequest(0, 3, BIG, ip))).status).toBe(429)
  })
})

describe('the merge request', () => {
  it('joins the shards\' comments in order, runs the checks on the whole, and answers what one request would, with a hand-off the reads accept', async () => {
    const a = await runShard(0, [inShard(0, 2), inShard(0, 5)])
    const b = await runShard(1, [inShard(1)])
    const c = await runShard(2, [inShard(2), inShard(2, 6)])
    fetchStub.mockClear()
    const res = await mergeRequest([a, b, c])
    const payload = (await res.json()) as MergeReply
    expect(res.status).toBe(200)
    expect(fetchStub).not.toHaveBeenCalled()
    expect(payload).toMatchObject({ success: true, stage: 'merge' })
    expect((payload.candidates ?? []).map((x) => x.id)).toEqual([1, 2, 3, 4, 5])
    expect((payload.candidates ?? []).map((x) => x.line)).toEqual([PLAN[0].from + 2, PLAN[0].from + 5, PLAN[1].from + 3, PLAN[2].from + 3, PLAN[2].from + 6])
    expect(payload.batches).toEqual([[1, 2, 3, 4], [5]])
    expect(payload.result).toMatchObject({ verified: false, lineCount: 450 })
    expect(payload.result?.comments.every((x) => x.verdict === 'unverified')).toBe(true)
    expect(payload.trace.map((s) => s.name)).toEqual(['Merge shards', 'Checks'])
    expect(payload.trace[0].detail).toBe('Joined 3 parts of 3: 5 comments')
    // The hand-off covers the merged comments and every shard.
    const text = JSON.parse((payload.handoff as { text: string }).text) as { comments: unknown[]; shards: unknown[] }
    expect(text.comments).toHaveLength(5)
    expect(text.shards).toEqual(PLAN.map((s) => ({ from: s.from, to: s.to, ok: true })))
    // And the reads accept it: a read of the first batch works on the whole file.
    script({ read1: [reply(verdictJson([2, 3, 4, 5].map((id) => keep(id - 1, (payload.candidates ?? [])[id - 2].line, LINES[(payload.candidates ?? [])[id - 2].line - 1].trim()))))] })
    const handoff = payload.handoff as NonNullable<MergeReply['handoff']>
    const read = await readHandler(1)(post({ ...BIG, handoff: { text: handoff.text, seal: handoff.seals['read-1'][0] } }, { url: url(`/api/ai/read-1?batch=0&review=${handoff.id}`) }))
    expect(read.status).toBe(200)
  })

  it('goes on without a shard that has no record, says so in the signed hand-off, and reviews the rest', async () => {
    const a = await runShard(0, [inShard(0)])
    const c = await runShard(2, [inShard(2)])
    const payload = (await (await mergeRequest([a, null, c])).json()) as MergeReply
    expect((payload.candidates ?? []).map((x) => x.id)).toEqual([1, 2])
    const text = JSON.parse((payload.handoff as { text: string }).text) as { shards: Array<{ ok: boolean }> }
    expect(text.shards.map((s) => s.ok)).toEqual([true, false, true])
    expect(payload.trace[0].detail).toBe('Joined 2 parts of 3: 2 comments, 1 part not reviewed')
  })

  it('removes a comment two shards both made: the same cited line and the same opening of the message', async () => {
    const dup = inShard(1)
    const a = await runShard(1, [dup])
    const b = await runShard(2, [{ ...dup }, inShard(2)])
    const payload = (await (await mergeRequest([null, a, b])).json()) as MergeReply
    // The second shard cited a line of the first one's range: both are the same comment.
    expect((payload.candidates ?? []).map((x) => x.line)).toEqual([PLAN[1].from + 3, PLAN[2].from + 3])
    expect(payload.trace[0].detail).toContain('1 duplicate removed')
  })

  it('has no hand-off when every comment was dropped by the checks', async () => {
    const a = await runShard(0, [{ ...inShard(0), line: 9999 }])
    const payload = (await (await mergeRequest([a, null, null])).json()) as MergeReply
    expect(payload.handoff).toBeNull()
    expect(payload.result).toMatchObject({ verified: true })
  })

  it('refuses, with no model call, a record the server did not sign, or signed for other code, another shard or another time', async () => {
    const a = await runShard(0, [inShard(0)])
    const b = await runShard(1, [inShard(1)])
    const c = await runShard(2, [inShard(2)])
    fetchStub.mockClear()
    const lines = LINES
    const forged = makeShardRecord('some-other-key', { kind: 'file', lang: 'go', lines }, 1, 3, [inShard(1)])
    const forgedRight = makeShardRecord(PLACEHOLDER_KEY, { kind: 'file', lang: 'go', lines }, 1, 3, [inShard(1)])
    const cases: Array<[string, unknown[], Record<string, unknown>]> = [
      ['another key', [a, forged, c], BIG],
      ['text changed', [a, { ...b, text: b.text.replace('ignores', 'IGNORES') }, c], BIG],
      ['swapped order', [b, a, c], BIG],
      ['other code', [a, b, c], { ...BIG, code: BIG.code.replace('step_5()', 'step_6()') }],
      ['not an object', [a, 'x', c], BIG],
      ['wrong count', [a, b], BIG],
    ]
    for (const [name, shards, body] of cases) {
      const res = await mergeRequest(shards, body)
      expect(res.status, name).toBe(400)
    }
    expect((await mergeRequest([a, forgedRight, c])).status).toBe(200)
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('refuses a record more than three minutes old, and says why', async () => {
    const a = await runShard(0, [inShard(0)])
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 180_001)
    const res = await mergeRequest([a, null, null])
    expect(res.status).toBe(400)
    expect(((await res.json()) as Payload).error).toBe('The first pass is more than 3 minutes old, so the second pass was refused. Run the review again.')
  })

  it('refuses when every shard failed, and when no shards are sent', async () => {
    expect((await mergeRequest([null, null, null])).status).toBe(400)
    expect((await mergeRequest(undefined)).status).toBe(400)
  })

  it('totals the usage of the shards on the shards\' own responses, and the merge calls no model, so it reports none of its own', async () => {
    const a = await runShard(0, [inShard(0)])
    const payload = (await (await mergeRequest([a, null, null])).json()) as MergeReply
    expect(payload.usage).toBeNull()
    expect((payload as unknown as { unreportedCalls: number }).unreportedCalls).toBe(0)
  })
})

