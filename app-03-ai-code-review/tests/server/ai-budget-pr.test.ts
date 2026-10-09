import { describe, expect, it, vi } from 'vitest'
import {
  CRITICAL_DIVIDE, DIVIDE_BODY, fetchStub, handler, installHooks, keep, post, providerReply, readPayload, reviewJson, sentBody, stepSummary, twoPasses,
  type FetchStub,
} from './harness'

installHooks()

describe('ai function: the time budget', () => {
  /** A fetch that never answers and ends only when its signal aborts. */
  const hang: FetchStub = (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })

  it('ends a hung first pass at its 17.4 s limit, and does not retry because pass 2 would then have no time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    fetchStub.mockImplementation(hang)
    const pending = handler(post(DIVIDE_BODY))
    await vi.advanceTimersByTimeAsync(17_399)
    expect(fetchStub).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    const res = await pending
    const payload = await readPayload(res)
    expect(res.status).toBe(504)
    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(payload.error).toBe('The AI provider did not answer in time.')
    expect(payload.trace[2]).toMatchObject({ name: 'Pass 1: review', status: 'failed', detail: 'No answer within 17.4 s (limit 17.4 s)' })
    expect(payload.trace[3]).toMatchObject({ name: 'Pass 1: review retry', status: 'skipped' })
    expect(payload.trace[3].detail).toMatch(/^Not retried: /)
  })

  it('ends a first pass whose body never finishes at the same limit, even though the stub ignores the abort', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const stalled = new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 })
    fetchStub.mockResolvedValueOnce(stalled)
    const pending = handler(post(DIVIDE_BODY))
    await vi.advanceTimersByTimeAsync(17_400)
    expect((await pending).status).toBe(504)
  })

  it('ends a hung second pass at 10.8 s, retries it once while the budget allows, and then shows the comments unverified', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    fetchStub.mockResolvedValueOnce(providerReply(reviewJson([CRITICAL_DIVIDE])))
    fetchStub.mockImplementation(hang)
    const pending = handler(post(DIVIDE_BODY))
    await vi.advanceTimersByTimeAsync(10_800)
    expect(fetchStub).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(10_800)
    const res = await pending
    const payload = await readPayload(res)
    expect(res.status).toBe(200)
    expect(fetchStub).toHaveBeenCalledTimes(3)
    expect(stepSummary(payload).slice(5)).toEqual(['Pass 2: verify:failed', 'Pass 2: verify retry:failed', 'Re-validate:ok'])
    expect(payload.result?.verified).toBe(false)
    expect(payload.result?.comments[0].verdict).toBe('unverified')
  })
})

// A real patch: the first file of psf/requests pull request 6963.
const PATCH = `@@ -219,14 +219,7 @@ def get_netrc_auth(url, raise_errors=False):
         netrc_path = None
 
         for f in netrc_locations:
-            try:
-                loc = os.path.expanduser(f)
-            except KeyError:
-                return
-
+            loc = os.path.expanduser(f)
             if os.path.exists(loc):
                 netrc_path = loc
                 break`
const PR_BODY = { mode: 'pr', files: [{ path: 'src/requests/utils.py', status: 'modified', patch: PATCH }] }

describe('ai function: a pull request review', () => {
  it('numbers the diff for the reviewer and tells it to comment on changed lines only', async () => {
    fetchStub.mockResolvedValueOnce(providerReply(reviewJson([])))
    await handler(post(PR_BODY))
    const sent = sentBody(0)
    expect(sent.messages[0].content).toContain('Review only the change')
    expect(sent.messages[1].content).toContain('1\t| === src/requests/utils.py (modified)')
    expect(sent.messages[1].content).toMatch(/\d+\t\| \+ {12}loc = os\.path\.expanduser\(f\)/)
    expect(sent.messages[1].content).toContain('Review this pull request diff (14 lines, 6 changed lines)')
  })

  it('anchors a comment to the file and line of the diff, on the side it is on', async () => {
    // Line 1 is the file header and line 2 the hunk header, so patch line i (the hunk header is 0) is numbered i + 2.
    const lineOf = (needle: string) => PATCH.split('\n').findIndex((l) => l.includes(needle)) + 2
    const added = lineOf('+            loc =')
    twoPasses(
      [{ line: added, quote: 'os.path.expanduser(f)', severity: 'warning', message: 'expanduser can raise KeyError when HOME is undefined.', suggestion: 'Catch KeyError and return None.', issue: true }],
      [keep(1, added, 'loc = os.path.expanduser(f)', 'The new line calls os.path.expanduser(f) with no handler.')],
    )
    const payload = await readPayload(await handler(post(PR_BODY)))
    const comment = payload.result?.comments[0]
    expect(comment).toMatchObject({ verdict: 'kept', where: { file: 'src/requests/utils.py', line: 222, side: 'new' } })
    expect(comment?.code).toBe('+            loc = os.path.expanduser(f)')
    expect(payload.result).toMatchObject({ mode: 'pr', pr: { filesIncluded: 1, changedIncluded: 6, charLimit: 50_000 } })
  })

  it('anchors a comment on a removed line to the old side', async () => {
    const removed = PATCH.split('\n').findIndex((l) => l.includes('-            try:')) + 2
    twoPasses(
      [{ line: removed, quote: 'try:', severity: 'info', message: 'The try block that guarded expanduser was removed.', suggestion: 'Restore it.', issue: true }],
      [keep(1, removed, 'try:', 'The removed line try: opened the guard.')],
    )
    const payload = await readPayload(await handler(post(PR_BODY)))
    expect(payload.result?.comments[0].where).toEqual({ file: 'src/requests/utils.py', line: 222, side: 'old' })
  })

  it('drops a comment on unchanged context, with the reason, and never sends it to the second pass', async () => {
    const ctx = PATCH.split('\n').findIndex((l) => l.includes('netrc_path = None')) + 2
    twoPasses(
      [{ line: ctx, quote: '', severity: 'info', message: 'netrc_path starts as None and is reassigned.', suggestion: 'Use a single expression.', issue: true }],
      [],
    )
    const payload = await readPayload(await handler(post(PR_BODY)))
    expect(payload.result?.comments[0]).toMatchObject({ verdict: 'dropped', decidedBy: 'check', where: { file: 'src/requests/utils.py', line: 219, side: 'new' } })
    expect(payload.result?.comments[0].reason).toBe('Cited an unchanged line of the diff. Comments may only sit on changed lines.')
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ mode: 'pr' }, /Choose at least one/],
    [{ mode: 'pr', files: [] }, /Choose at least one/],
    [{ mode: 'pr', files: [{ path: 'a.ts', status: 'modified' }] }, /missing its path or its patch/],
    [{ mode: 'pr', files: [{ path: 'a.ts', status: 'modified', patch: '@@ -1 +1 @@\n context only' }] }, /no added or removed lines/],
  ])('answers 400 for %j', async (payload, message) => {
    const res = await handler(post(payload))
    expect(res.status).toBe(400)
    expect((await readPayload(res)).error).toMatch(message)
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('refuses a diff over the character limit with its size, and never truncates it', async () => {
    const lines = Array.from({ length: 700 }, (_, i) => `+${'x'.repeat(100)}${i}`).join('\n')
    const res = await handler(post({ mode: 'pr', files: [{ path: 'big.ts', status: 'added', patch: `@@ -0,0 +1,700 @@\n${lines}` }] }))
    const payload = await readPayload(res)
    expect(res.status).toBe(400)
    expect(payload.error).toMatch(/^The selected files are [\d,]+ characters of diff\. A review reads up to 50,000: untick a file\.$/)
    expect(fetchStub).not.toHaveBeenCalled()
  })
})
