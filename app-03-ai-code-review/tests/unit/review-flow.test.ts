import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commentBudget } from '../../netlify/shared/review'
import { planShards } from '../../netlify/shared/shards'
import { ReviewError, reviewCode, reviewPullRequest } from '../../src/lib/api'
import type { ReviewRun } from '../../src/types'

// The browser's side of a review: request 1 (pass 1), then requests 2 and 3 (the two reads of pass 2) side by side.
// The server's answers are stubs shaped like the real ones (netlify/shared/wire.ts).

type FetchStub = (input: string, init: RequestInit) => Promise<Response>
const fetchStub = vi.fn<FetchStub>()

beforeEach(() => {
  fetchStub.mockReset()
  fetchStub.mockRejectedValue(new Error('unexpected network call'))
  vi.stubGlobal('fetch', fetchStub)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const json = (payload: unknown, status = 200): Response => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
const CODE = 'def divide(a, b):\n    return a / b'
const HANDOFF_TEXT = '{"v":2,"iat":1,"hash":"h","comments":[],"batches":[]}'
/** What pass 1 hands the browser for a review of `batches` batches: one seal for each read request. */
const handoffOf = (batches: number) => ({ id: 'a'.repeat(32), text: HANDOFF_TEXT, seals: { 'read-1': Array.from({ length: batches }, (_, i) => `s1-${i}`), 'read-2': Array.from({ length: batches }, (_, i) => `s2-${i}`) } })
const HANDOFF = handoffOf(1)
/** The ticket a read request carries for one batch, and its review id in the URL. */
const ticket = (n: 1 | 2, batch: number) => ({ text: HANDOFF_TEXT, seal: `s${n}-${batch}` })
const reviewQuery = `review=${'a'.repeat(32)}`

const CANDIDATE = { id: 1, line: 2, fromLine: 2, quote: 'return a / b', severity: 'critical', message: 'Dividing by zero raises ZeroDivisionError.', suggestion: 'Check b first.', moveNote: null, loweredFrom: null }
const DROP = { id: 2, line: 1, fromLine: 1, severity: 'info', message: 'Name is vague.', suggestion: 'Rename it.', reason: 'The code it quotes is not nearby.' }
const waiting = (id: number, reason: string) => ({
  id, line: 2, fromLine: 2, severity: 'critical', message: CANDIDATE.message, suggestion: CANDIDATE.suggestion, verdict: 'unverified', decidedBy: 'none', reason, evidence: null, support: null, supportLine: null, claimKind: null, code: '    return a / b', where: null,
})
const dropped = { ...waiting(2, DROP.reason), line: 1, fromLine: 1, severity: 'info', verdict: 'dropped', decidedBy: 'check', message: DROP.message, suggestion: DROP.suggestion, code: 'def divide(a, b):' }
const RESULT = { comments: [waiting(1, 'Waiting for the second pass'), dropped], lineCount: 2, truncated: false, verified: false, malformed: 0, mode: 'file', pr: null }
const step = (name: string, extra: Record<string, unknown> = {}) => ({ name, status: 'ok', ms: 1000, at: 0, detail: 'done', ...extra })
const SUMMARY = (trace: unknown[], extra: Record<string, unknown> = {}) => ({ trace, usage: { total_tokens: 100, cost: 0.001 }, model: 'm1', newestModel: 'm1', modelCheck: 'match', servedModels: [{ pass: 'p', model: 'm1' }], totalMs: 5000, ...extra })

const FIRST = json({
  success: true, stage: 'review', result: RESULT, candidates: [CANDIDATE], dropped: [DROP], batches: [[1]], handoff: HANDOFF,
  ...SUMMARY([step('Check request'), step('Build prompt'), step('Pass 1: review', { ms: 18000, at: 10, finish: 'stop', reasoningTokens: 2100 }), step('Parse reply'), step('Checks')]),
})
const keptRow = { id: 1, line: 2, verdict: 'kept', decidedBy: 'verifier', reason: 'return a / b has no guard.', evidence: 'return a / b', support: 'return a / b', supportAt: 2, claimKind: 'other' }
const standsRow = { id: 1, state: 'stands', reason: 'Nothing breaks the claim.', quote: 'return a / b' }
const readOk = (n: 1 | 2, rows: unknown[]) => json({ success: true, stage: `read-${n}`, read: n, rows, ...SUMMARY([step(n === 1 ? 'Pass 2: verify (read 1)' : 'Pass 2: verify (read 2, adversary)', { ms: 9000 })]) })

/** Answers each request by its path. */
function answer(by: Record<string, (init: RequestInit) => Response | Promise<Response>>): void {
  fetchStub.mockImplementation(async (url, init) => {
    const call = by[url.split('?')[0]]
    if (!call) throw new Error(`unexpected request ${url}`)
    return call(init)
  })
}
const bodyOf = (init: RequestInit) => JSON.parse(String(init.body)) as Record<string, unknown>

describe('a review is three requests: pass 1, then the two reads side by side', () => {
  it('posts the code to pass 1, then posts the code and the unchanged hand-off to both reads, and shows the result both reads agree on', async () => {
    answer({ '/api/ai': () => FIRST.clone(), '/api/ai/read-1': () => readOk(1, [keptRow]), '/api/ai/read-2': () => readOk(2, [standsRow]) })
    const run = await reviewCode(CODE, 'python')
    expect(fetchStub.mock.calls.map(([url]) => url)).toEqual(['/api/ai', `/api/ai/read-1?batch=0&${reviewQuery}`, `/api/ai/read-2?batch=0&${reviewQuery}`])
    expect(bodyOf(fetchStub.mock.calls[0][1])).toEqual({ code: CODE, language: 'python' })
    for (const call of [1, 2] as const) expect(bodyOf(fetchStub.mock.calls[call][1])).toEqual({ code: CODE, language: 'python', handoff: ticket(call, 0) })
    expect(run.result.verified).toBe(true)
    expect(run.result.comments.map((c) => [c.id, c.verdict])).toEqual([[1, 'kept'], [2, 'dropped']])
    expect(run.result.comments[0]).toMatchObject({ decidedBy: 'verifier', evidence: 'return a / b', code: '    return a / b' })
  })

  it('starts both reads before either answers', async () => {
    const gates: Array<() => void> = []
    const held = (n: 1 | 2, rows: unknown[]) => () => new Promise<Response>((resolve) => gates.push(() => resolve(readOk(n, rows))))
    answer({ '/api/ai': () => FIRST.clone(), '/api/ai/read-1': held(1, [keptRow]), '/api/ai/read-2': held(2, [standsRow]) })
    const pending = reviewCode(CODE, 'python')
    await vi.waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(3))
    expect(gates).toHaveLength(2)
    gates.forEach((open) => open())
    expect((await pending).result.verified).toBe(true)
  })

  it('hands pass 1 comments to the page as soon as pass 1 is back, none of them confirmed, before the reads answer', async () => {
    let release: () => void = () => {}
    const slow = (n: 1 | 2, rows: unknown[]) => () => new Promise<Response>((resolve) => { release = () => resolve(readOk(n, rows)) })
    answer({ '/api/ai': () => FIRST.clone(), '/api/ai/read-1': slow(1, [keptRow]), '/api/ai/read-2': () => readOk(2, [standsRow]) })
    const seen: ReviewRun[] = []
    const pending = reviewCode(CODE, 'python', undefined, (r) => seen.push(r))
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0].result.verified).toBe(false)
    expect(seen[0].result.comments.filter((c) => c.verdict === 'kept' || c.verdict === 'moved')).toEqual([])
    expect(seen[0].trace.map((s) => s.name)).toEqual(['Check request', 'Build prompt', 'Pass 1: review', 'Parse reply', 'Checks'])
    release()
    const run = await pending
    expect(seen).toHaveLength(1)
    expect(run.result.comments[0].verdict).toBe('kept')
  })

  it('merges the three traces in order, places the reads after pass 1, and sums usage and the model checks', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    answer({
      '/api/ai': async () => { vi.setSystemTime(Date.now() + 18_000); return FIRST.clone() },
      '/api/ai/read-1': async () => { vi.setSystemTime(Date.now() + 9_000); return readOk(1, [keptRow]) },
      '/api/ai/read-2': () => readOk(2, [standsRow]),
    })
    const run = await reviewCode(CODE, 'python')
    expect(run.trace.map((s) => s.name)).toEqual(['Check request', 'Build prompt', 'Pass 1: review', 'Parse reply', 'Checks', 'Pass 2: verify (read 1)', 'Pass 2: verify (read 2, adversary)', 'Re-validate'])
    const read1 = run.trace[5]
    expect(read1.at).toBeGreaterThanOrEqual(18_000)
    expect(run.trace[7].at).toBeGreaterThanOrEqual(read1.at as number)
    expect(run.trace[2]).toMatchObject({ finish: 'stop', reasoningTokens: 2100 })
    expect(run.usage).toEqual({ total_tokens: 300, cost: 0.003 })
    expect(run.servedModels).toHaveLength(3)
    expect(run.model).toBe('m1')
    expect(run.totalMs).toBe(27_000)
  })

  it('does not call the reads when nothing is left to read, and does not call it a first-pass view', async () => {
    answer({ '/api/ai': () => json({ success: true, stage: 'review', result: { ...RESULT, comments: [dropped], verified: true }, candidates: [], dropped: [DROP], batches: [], handoff: null, ...SUMMARY([step('Check request')]) }) })
    const seen: ReviewRun[] = []
    const run = await reviewCode(CODE, 'python', undefined, (r) => seen.push(r))
    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([])
    expect(run.result.verified).toBe(true)
  })

  it('sends a pull request to the reads the same way, and places comments by the diff', async () => {
    const files = [{ path: 'a.go', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }]
    answer({
      '/api/ai': () => json({ success: true, stage: 'review', result: { ...RESULT, mode: 'pr' }, candidates: [{ ...CANDIDATE, line: 4, fromLine: 4 }], dropped: [], batches: [[1]], handoff: HANDOFF, ...SUMMARY([step('Check request')]) }),
      '/api/ai/read-1': () => readOk(1, [{ ...keptRow, line: 4, supportAt: 4 }]),
      '/api/ai/read-2': () => readOk(2, [standsRow]),
    })
    const run = await reviewPullRequest(files)
    expect(bodyOf(fetchStub.mock.calls[1][1])).toEqual({ mode: 'pr', files, handoff: ticket(1, 0) })
    expect(run.result.comments[0].where).toEqual({ file: 'a.go', line: 1, side: 'new' })
  })
})

describe('a read that does not finish', () => {
  const readFails = (status: number, error = 'The AI provider did not answer in time.') => () => json({ success: false, error, ...SUMMARY([step('Pass 2: verify (read 1)', { status: 'failed', ms: 22000 })]) }, status)

  it('keeps the comments as not confirmed and says the second pass did not finish, when read 1 times out', async () => {
    answer({ '/api/ai': () => FIRST.clone(), '/api/ai/read-1': readFails(504), '/api/ai/read-2': () => readOk(2, [standsRow]) })
    const run = await reviewCode(CODE, 'python')
    expect(run.result.verified).toBe(false)
    expect(run.result.comments[0]).toMatchObject({ verdict: 'unverified', decidedBy: 'none' })
    expect(run.result.comments[0].reason).toMatch(/did not finish/)
    expect(run.trace.find((s) => s.name === 'Pass 2: verify (read 1)')).toMatchObject({ status: 'failed' })
    expect(run.trace[run.trace.length - 1].detail).toMatch(/^A second-pass read did not finish: 1 comment not confirmed/)
  })

  it('never confirms a comment when read 2 does not finish, whatever read 1 said', async () => {
    answer({ '/api/ai': () => FIRST.clone(), '/api/ai/read-1': () => readOk(1, [keptRow]), '/api/ai/read-2': readFails(502) })
    const run = await reviewCode(CODE, 'python')
    expect(run.result.verified).toBe(false)
    expect(run.result.comments[0].verdict).toBe('unverified')
    expect(run.result.comments[0].reason).toMatch(/adversarial read did not finish/)
  })

  it('does not confirm a comment the adversarial read found code against', async () => {
    answer({ '/api/ai': () => FIRST.clone(), '/api/ai/read-1': () => readOk(1, [keptRow]), '/api/ai/read-2': () => readOk(2, [{ ...standsRow, state: 'refuted', reason: 'b is checked above.' }]) })
    const run = await reviewCode(CODE, 'python')
    expect(run.result.verified).toBe(true)
    expect(run.result.comments[0].verdict).toBe('unverified')
  })

  it('counts a read whose rows do not cover every comment as not finished', async () => {
    answer({ '/api/ai': () => FIRST.clone(), '/api/ai/read-1': () => readOk(1, []), '/api/ai/read-2': () => readOk(2, [standsRow]) })
    const run = await reviewCode(CODE, 'python')
    expect(run.result.verified).toBe(false)
    expect(run.result.comments[0].verdict).toBe('unverified')
  })

  it('counts a read that came back as a refused hand-off as not finished, and keeps the server message out of the verdict', async () => {
    answer({ '/api/ai': () => FIRST.clone(), '/api/ai/read-1': readFails(400, 'The first pass does not match this code.'), '/api/ai/read-2': readFails(400, 'The first pass does not match this code.') })
    const run = await reviewCode(CODE, 'python')
    expect(run.result.verified).toBe(false)
    expect(run.result.comments.filter((c) => c.verdict === 'kept' || c.verdict === 'moved')).toEqual([])
  })
})

describe('pass 1 that does not finish, and a stopped or replaced review', () => {
  it('fails the review with the server message and calls no read when pass 1 is refused or cut off', async () => {
    answer({ '/api/ai': () => json({ success: false, error: 'The AI ran out of reply length before it finished the review. Try a shorter snippet.', ...SUMMARY([step('Pass 1: review', { status: 'failed' })]) }, 502) })
    const err = await reviewCode(CODE, 'python').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ReviewError)
    expect((err as ReviewError).message).toMatch(/ran out of reply length/)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('aborts both pending reads when the review is stopped, and rejects as an abort', async () => {
    const signals: AbortSignal[] = []
    const hang = (init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signals.push(init.signal as AbortSignal)
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })
    answer({ '/api/ai': () => FIRST.clone(), '/api/ai/read-1': hang, '/api/ai/read-2': hang })
    const controller = new AbortController()
    const pending = reviewCode(CODE, 'python', controller.signal).catch((e: unknown) => e)
    await vi.waitFor(() => expect(signals).toHaveLength(2))
    controller.abort()
    const err = await pending
    expect(err).not.toBeInstanceOf(ReviewError)
    expect((err as Error).name).toBe('AbortError')
    expect(signals.every((s) => s.aborted)).toBe(true)
  })

  it('cancels the old review\'s pending reads when a new review replaces it', async () => {
    const signals: AbortSignal[] = []
    answer({
      '/api/ai': () => FIRST.clone(),
      '/api/ai/read-1': (init) => new Promise<Response>((_r, reject) => { signals.push(init.signal as AbortSignal); init.signal?.addEventListener('abort', () => reject(init.signal?.reason)) }),
      '/api/ai/read-2': (init) => new Promise<Response>((_r, reject) => { signals.push(init.signal as AbortSignal); init.signal?.addEventListener('abort', () => reject(init.signal?.reason)) }),
    })
    const first = new AbortController()
    const old = reviewCode(CODE, 'python', first.signal).catch((e: unknown) => e)
    await vi.waitFor(() => expect(signals).toHaveLength(2))
    // The page replaces a run by aborting its controller before it starts the next.
    first.abort()
    expect(((await old) as Error).name).toBe('AbortError')
    expect(signals.every((s) => s.aborted)).toBe(true)
  })
})

describe('billed usage across the three requests', () => {
  const failedRead = (n: 1 | 2, unreportedCalls: number, usage: unknown) =>
    json({ success: false, error: 'The AI ran out of reply length before it finished checking the comments. Try a shorter snippet.', unreportedCalls, ...SUMMARY([step(`Pass 2: verify (read ${n})`, { status: 'failed', tokens: 200 })], { usage }) }, 502)

  it('adds up pass 1, a read that succeeded and a read that failed after being billed, and says nothing is missing', async () => {
    answer({ '/api/ai': () => FIRST.clone(), '/api/ai/read-1': () => failedRead(1, 0, { total_tokens: 200, cost: 0.002 }), '/api/ai/read-2': () => readOk(2, [standsRow]) })
    const run = await reviewCode(CODE, 'python')
    expect(run.usage).toEqual({ total_tokens: 400, cost: 0.004 })
    expect(run.unreportedCalls).toBe(0)
  })

  it('counts a read that timed out without usage as not reported, so the total is partial', async () => {
    answer({ '/api/ai': () => FIRST.clone(), '/api/ai/read-1': () => failedRead(1, 1, null), '/api/ai/read-2': () => readOk(2, [standsRow]) })
    const run = await reviewCode(CODE, 'python')
    expect(run.usage).toEqual({ total_tokens: 200, cost: 0.002 })
    expect(run.unreportedCalls).toBe(1)
  })

  it('counts a read whose request never got an answer (the connection dropped) as not reported', async () => {
    answer({ '/api/ai': () => FIRST.clone(), '/api/ai/read-1': () => { throw new TypeError('Failed to fetch') }, '/api/ai/read-2': () => readOk(2, [standsRow]) })
    const run = await reviewCode(CODE, 'python')
    expect(run.unreportedCalls).toBeGreaterThanOrEqual(1)
    expect(run.usage).toEqual({ total_tokens: 200, cost: 0.002 })
  })

  it('carries what pass 1 spent on the failure when pass 1 itself fails, and counts a pass 1 the server never answered as not reported', async () => {
    answer({ '/api/ai': () => json({ success: false, error: 'x', unreportedCalls: 0, ...SUMMARY([step('Pass 1: review', { status: 'failed' })]) }, 502) })
    const err = (await reviewCode(CODE, 'python').catch((e: unknown) => e)) as ReviewError
    expect(err.summary.usage).toEqual({ total_tokens: 100, cost: 0.001 })
    expect(err.summary.unreportedCalls).toBe(0)
    fetchStub.mockReset()
    fetchStub.mockRejectedValue(new TypeError('Failed to fetch'))
    const lost = (await reviewCode(CODE, 'python').catch((e: unknown) => e)) as ReviewError
    expect(lost.summary.unreportedCalls).toBeGreaterThanOrEqual(1)
  })

  it('counts a platform cut-off page (not the function\'s JSON) as a call that may have been billed', async () => {
    answer({ '/api/ai': () => new Response('<html>502 Gateway</html>', { status: 502 }) })
    const err = (await reviewCode(CODE, 'python').catch((e: unknown) => e)) as ReviewError
    expect(err.summary.unreportedCalls).toBe(1)
  })

  it('counts the connection that dropped before a retry succeeded, because it may have reached the server', async () => {
    let calls = 0
    answer({ '/api/ai': () => { calls += 1; if (calls === 1) throw new TypeError('Failed to fetch'); return json({ success: true, stage: 'review', result: { ...RESULT, comments: [dropped], verified: true }, candidates: [], dropped: [DROP], batches: [], handoff: null, unreportedCalls: 0, ...SUMMARY([step('Check request')]) }) } })
    const run = await reviewCode(CODE, 'python')
    expect(run.unreportedCalls).toBe(1)
  })
})

describe('batches of four comments per read request', () => {
  const cand = (id: number) => ({ ...CANDIDATE, id, line: 2, fromLine: 2 })
  const keptFor = (id: number): object => ({ ...keptRow, id })
  const standsFor = (id: number): object => ({ ...standsRow, id })
  const firstWith = (count: number, batches: number[][]) =>
    json({
      success: true, stage: 'review', unreportedCalls: 0,
      result: { ...RESULT, comments: Array.from({ length: count }, (_, i) => waiting(i + 1, 'Waiting')) },
      candidates: Array.from({ length: count }, (_, i) => cand(i + 1)), dropped: [], handoff: handoffOf(batches.length), batches,
      ...SUMMARY([step('Check request')]),
    })
  const ids = (batch: number[]) => batch
  const rowsFor = (url: string, make: (id: number) => object, batches: number[][]) => batches[Number(new URL(`http://x${url}`).searchParams.get('batch'))].map(make)
  const urlOf = (url: string) => url.split('?')[0]
  const BATCHES = [[1, 2, 3, 4], [5, 6, 7, 8], [9]]

  it('sends each read once per batch, in parallel, each with the whole input, the hand-off and its batch number', async () => {
    const started: string[] = []
    fetchStub.mockImplementation(async (url, init) => {
      if (url === '/api/ai') return firstWith(9, BATCHES)
      started.push(url)
      const batch = Number(new URL(`http://x${url}`).searchParams.get('batch'))
      expect(bodyOf(init)).toEqual({ code: CODE, language: 'python', handoff: ticket(url.startsWith('/api/ai/read-1') ? 1 : 2, batch) })
      const read1 = urlOf(url) === '/api/ai/read-1'
      return readOk(read1 ? 1 : 2, rowsFor(url, read1 ? keptFor : standsFor, BATCHES))
    })
    const run = await reviewCode(CODE, 'python')
    expect(fetchStub).toHaveBeenCalledTimes(7)
    expect(started.sort()).toEqual([0, 1, 2].map((b) => `/api/ai/read-1?batch=${b}&${reviewQuery}`).concat([0, 1, 2].map((b) => `/api/ai/read-2?batch=${b}&${reviewQuery}`)))
    expect(run.result.verified).toBe(true)
    expect(run.result.comments.map((c) => c.verdict)).toEqual(Array(9).fill('kept'))
    expect(run.unreportedCalls).toBe(0)
  })

  it('starts every batch request before any answers', async () => {
    const gates: Array<() => void> = []
    fetchStub.mockImplementation(async (url) => {
      if (url === '/api/ai') return firstWith(9, BATCHES)
      const read1 = urlOf(url) === '/api/ai/read-1'
      return new Promise<Response>((resolve) => gates.push(() => resolve(readOk(read1 ? 1 : 2, rowsFor(url, read1 ? keptFor : standsFor, BATCHES)))))
    })
    const pending = reviewCode(CODE, 'python')
    await vi.waitFor(() => expect(gates).toHaveLength(6))
    gates.forEach((open) => open())
    expect((await pending).result.verified).toBe(true)
  })

  it('leaves only the comments of a failed batch not confirmed, with the existing note, and keeps the others', async () => {
    fetchStub.mockImplementation(async (url) => {
      if (url === '/api/ai') return firstWith(9, BATCHES)
      if (url.startsWith('/api/ai/read-1?batch=1')) return json({ success: false, error: 'The AI provider did not answer in time.', unreportedCalls: 1, ...SUMMARY([step('Pass 2: verify (read 1, batch 2 of 3)', { status: 'failed', ms: 22000 })], { usage: null }) }, 504)
      const read1 = urlOf(url) === '/api/ai/read-1'
      return readOk(read1 ? 1 : 2, rowsFor(url, read1 ? keptFor : standsFor, BATCHES))
    })
    const run = await reviewCode(CODE, 'python')
    expect(run.result.verified).toBe(false)
    expect(run.result.comments.map((c) => c.verdict)).toEqual(['kept', 'kept', 'kept', 'kept', 'unverified', 'unverified', 'unverified', 'unverified', 'kept'])
    expect(run.result.comments[4].reason).toMatch(/did not finish/)
    expect(run.unreportedCalls).toBe(1)
    expect(run.trace.find((s) => s.name === 'Pass 2: verify (read 1, batch 2 of 3)')).toMatchObject({ status: 'failed' })
    expect(run.trace[run.trace.length - 1].detail).toMatch(/^A second-pass read did not finish: 4 comments not confirmed/)
  })

  it('treats a batch whose rows do not match its comments as not finished', async () => {
    fetchStub.mockImplementation(async (url) => {
      if (url === '/api/ai') return firstWith(5, [[1, 2, 3, 4], [5]])
      const read1 = urlOf(url) === '/api/ai/read-1'
      // Batch 1 (comment 5 alone) answers with the rows of batch 0 instead of its own.
      const ids = url.includes('batch=0') ? [1, 2, 3, 4] : [1]
      return readOk(read1 ? 1 : 2, ids.map((id) => (read1 ? keptFor(id) : standsFor(id))))
    })
    const run = await reviewCode(CODE, 'python')
    expect(run.result.comments[4].verdict).toBe('unverified')
    expect(run.result.verified).toBe(false)
  })

  it('keeps the verdicts a batch did settle when its read answered for only some of the comments, and leaves the rest not confirmed', async () => {
    fetchStub.mockImplementation(async (url) => {
      if (url === '/api/ai') return firstWith(4, [[1, 2, 3, 4]])
      const read1 = urlOf(url) === '/api/ai/read-1'
      // Read 1 settled comments 1 and 2 only.
      return readOk(read1 ? 1 : 2, (read1 ? [1, 2] : [1, 2, 3, 4]).map((id) => (read1 ? keptFor(id) : standsFor(id))))
    })
    const run = await reviewCode(CODE, 'python')
    expect(run.result.comments.map((c) => c.verdict)).toEqual(['kept', 'kept', 'unverified', 'unverified'])
    expect(run.result.comments[2].reason).toMatch(/did not finish/)
    expect(run.result.verified).toBe(false)
  })

  it('refuses rows that name a comment the batch does not hold, or repeat one', async () => {
    for (const rows of [[1, 2, 3, 4, 5], [1, 1, 2, 3]]) {
      fetchStub.mockReset()
      fetchStub.mockImplementation(async (url) => {
        if (url === '/api/ai') return firstWith(4, [[1, 2, 3, 4]])
        const read1 = urlOf(url) === '/api/ai/read-1'
        return readOk(read1 ? 1 : 2, (read1 ? rows : [1, 2, 3, 4]).map((id) => (read1 ? keptFor(id) : standsFor(id))))
      })
      const run = await reviewCode(CODE, 'python')
      expect(run.result.verified).toBe(false)
      expect(run.result.comments.map((c) => c.verdict)).toEqual(['unverified', 'unverified', 'unverified', 'unverified'])
    }
  })

  it('uses one request per read when the comments fit in a batch, and none when there are none', async () => {
    fetchStub.mockImplementation(async (url) => {
      if (url === '/api/ai') return firstWith(3, [[1, 2, 3]])
      const read1 = urlOf(url) === '/api/ai/read-1'
      return readOk(read1 ? 1 : 2, [1, 2, 3].map((id) => (read1 ? keptFor(id) : standsFor(id))))
    })
    await reviewCode(CODE, 'python')
    expect(fetchStub).toHaveBeenCalledTimes(3)
    expect(ids([1])).toEqual([1])
  })
})

describe('a large file is reviewed in shards', () => {
  const BIG_LINES = Array.from({ length: 450 }, (_, i) => (i % 30 === 0 ? `func f${i / 30}() {` : i % 30 === 28 ? '}' : i % 30 === 29 ? '' : `\tstep_${i + 1}()`))
  const BIG = BIG_LINES.join('\n')
  const PLAN = planShards(BIG_LINES, null, commentBudget(450))
  const shardOk = (i: number, extra: Record<string, unknown> = {}) =>
    json({ success: true, stage: 'review', shard: i, of: 3, record: { text: `text-${i}`, seal: `seal-${i}` }, unreportedCalls: 0, ...SUMMARY([step(`Pass 1: review (lines ${PLAN[i].from}-${PLAN[i].to})`, { ms: 15_000, at: 5 })], extra) })
  const shardFails = (status: number, error: string, extra: Record<string, unknown> = {}) =>
    json({ success: false, error, unreportedCalls: 1, ...SUMMARY([step('Pass 1: review', { status: 'failed', ms: 24_000 })], { usage: null, ...extra }) }, status)
  const mergeOk = () =>
    json({
      success: true, stage: 'merge', unreportedCalls: 0,
      result: { ...RESULT, lineCount: 450 }, candidates: [CANDIDATE], dropped: [DROP], batches: [[1]], handoff: handoffOf(1),
      ...SUMMARY([step('Merge shards', { ms: 20 }), step('Checks', { ms: 5 })], { usage: null, model: null, modelCheck: 'not-reported', servedModels: [] }),
    })
  const route = (shard: (i: number) => Response | Promise<Response>, merge: () => Response | Promise<Response> = mergeOk) =>
    fetchStub.mockImplementation(async (url) => {
      const path = url.split('?')[0]
      if (path === '/api/ai') return shard(Number(new URL(`http://x${url}`).searchParams.get('shard')))
      if (path === '/api/ai/merge') return merge()
      return readOk(path === '/api/ai/read-1' ? 1 : 2, [path === '/api/ai/read-1' ? keptRow : standsRow])
    })

  it('sends a request for each shard at once, then one merge with every record, then the reads', async () => {
    const gates: Array<() => void> = []
    fetchStub.mockImplementation(async (url, init) => {
      const path = url.split('?')[0]
      if (path === '/api/ai') {
        const i = Number(new URL(`http://x${url}`).searchParams.get('shard'))
        expect(bodyOf(init)).toEqual({ code: BIG, language: 'go' })
        return new Promise<Response>((resolve) => gates.push(() => resolve(shardOk(i))))
      }
      if (path === '/api/ai/merge') return mergeOk()
      return readOk(path === '/api/ai/read-1' ? 1 : 2, [path === '/api/ai/read-1' ? keptRow : standsRow])
    })
    const pending = reviewCode(BIG, 'go')
    await vi.waitFor(() => expect(gates).toHaveLength(3))
    expect(fetchStub.mock.calls.map(([u]) => u)).toEqual([0, 1, 2].map((i) => `/api/ai?shard=${i}&of=3`))
    gates.forEach((open) => open())
    const run = await pending
    const calls = fetchStub.mock.calls.map(([u]) => u.split('?')[0])
    expect(calls).toEqual(['/api/ai', '/api/ai', '/api/ai', '/api/ai/merge', '/api/ai/read-1', '/api/ai/read-2'])
    expect(bodyOf(fetchStub.mock.calls[3][1])).toEqual({ code: BIG, language: 'go', shards: [0, 1, 2].map((i) => ({ text: `text-${i}`, seal: `seal-${i}` })) })
    expect(run.result.verified).toBe(true)
    expect(run.result.notReviewed).toEqual([])
    expect(run.result.comments[0].verdict).toBe('kept')
  })

  it('goes on without a shard that failed, sends null for it, and names its lines on the result', async () => {
    route((i) => (i === 1 ? shardFails(504, 'The AI provider did not answer in time.') : shardOk(i)))
    const run = await reviewCode(BIG, 'go')
    const merge = fetchStub.mock.calls.find(([u]) => u === '/api/ai/merge') as [string, RequestInit]
    expect((bodyOf(merge[1]).shards as unknown[])[1]).toBeNull()
    expect(run.result.notReviewed).toEqual([{ from: PLAN[1].from, to: PLAN[1].to, label: `lines ${PLAN[1].from}-${PLAN[1].to}`, reason: 'The AI provider did not answer in time.' }])
    expect(run.result.verified).toBe(true)
    expect(run.unreportedCalls).toBe(1)
  })

  it('shows the not-reviewed ranges as soon as the first pass is back', async () => {
    route((i) => (i === 2 ? shardFails(502, 'The AI ran out of reply length before it finished the review. Try a shorter snippet.') : shardOk(i)))
    const seen: ReviewRun[] = []
    await reviewCode(BIG, 'go', undefined, (r) => seen.push(r))
    expect(seen).toHaveLength(1)
    expect(seen[0].result.notReviewed?.map((n) => n.label)).toEqual([`lines ${PLAN[2].from}-${PLAN[2].to}`])
    expect(seen[0].result.verified).toBe(false)
  })

  it('fails the review, with the shards\' usage and unreported calls, when every shard fails; and calls neither merge nor reads', async () => {
    route(() => shardFails(504, 'The AI provider did not answer in time.', { usage: { total_tokens: 100, cost: 0.001 } }))
    const err = (await reviewCode(BIG, 'go').catch((e: unknown) => e)) as ReviewError
    expect(err).toBeInstanceOf(ReviewError)
    expect(err.message).toBe('The AI provider did not answer in time.')
    expect(err.summary.usage).toEqual({ total_tokens: 300, cost: 0.003 })
    expect(err.summary.unreportedCalls).toBe(3)
    expect(fetchStub).toHaveBeenCalledTimes(3)
  })

  it('fails the review, with the shards\' usage, when the merge fails', async () => {
    route((i) => shardOk(i), () => json({ success: false, error: 'The first pass does not match this code.', unreportedCalls: 0, ...SUMMARY([step('Check request', { status: 'failed' })], { usage: null }) }, 400))
    const err = (await reviewCode(BIG, 'go').catch((e: unknown) => e)) as ReviewError
    expect(err).toBeInstanceOf(ReviewError)
    expect(err.message).toBe('The first pass does not match this code.')
    expect(err.summary.usage).toEqual({ total_tokens: 300, cost: 0.003 })
    expect(fetchStub).toHaveBeenCalledTimes(4)
  })

  it('places the merge after the shards on the trace and adds the shards\' usage to the totals', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    route((i) => { vi.setSystemTime(Date.now() + 5_000); return shardOk(i) })
    const run = await reviewCode(BIG, 'go')
    const names = run.trace.map((s) => s.name)
    expect(names.slice(0, 3)).toEqual(PLAN.map((s) => `Pass 1: review (lines ${s.from}-${s.to})`))
    expect(names.slice(3, 5)).toEqual(['Merge shards', 'Checks'])
    expect(run.trace[3].at).toBeGreaterThanOrEqual(15_000)
    expect(run.usage).toEqual({ total_tokens: 500, cost: 0.005 })
    expect(run.model).toBe('m1')
  })

  it('treats a shard reply with no record as a failed shard', async () => {
    route((i) => (i === 0 ? json({ success: true, stage: 'review', shard: 0, of: 3, ...SUMMARY([step('Pass 1: review')]) }) : shardOk(i)))
    const run = await reviewCode(BIG, 'go')
    expect(run.result.notReviewed?.map((n) => n.from)).toEqual([PLAN[0].from])
  })

  it('uses one plain request for a file that fits in one shard, and says nothing about parts', async () => {
    answer({ '/api/ai': () => FIRST.clone(), '/api/ai/read-1': () => readOk(1, [keptRow]), '/api/ai/read-2': () => readOk(2, [standsRow]) })
    await reviewCode(CODE, 'python')
    expect(fetchStub.mock.calls[0][0]).toBe('/api/ai')
  })

  it('names the files of a failed range for a pull request', async () => {
    const patch = (name: string) => ({ path: name, status: 'modified', patch: `@@ -1,50 +1,50 @@\n${Array.from({ length: 50 }, (_, i) => `-old ${i}\n+new ${i}`).join('\n')}` })
    const files = [patch('a.go'), patch('b.go'), patch('c.go')]
    fetchStub.mockImplementation(async (url) => {
      const path = url.split('?')[0]
      const i = Number(new URL(`http://x${url}`).searchParams.get('shard'))
      if (path === '/api/ai') return i === 1 ? shardFails(504, 'The AI provider did not answer in time.') : shardOk(i)
      return mergeOk()
    })
    const run = await reviewPullRequest(files).catch((e: unknown) => e)
    const result = (run as ReviewRun).result
    expect(result.notReviewed).toHaveLength(1)
    expect(result.notReviewed?.[0].label).toContain('b.go')
  })
})
