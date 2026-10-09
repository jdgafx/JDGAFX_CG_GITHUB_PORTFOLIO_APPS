import { describe, expect, it } from 'vitest'
import {
  COMPLETE, CRITICAL_DIVIDE, DIVIDE_BODY, FIVE, HOURS_BODY, fetchStub, handler, installHooks, keep, post, providerReply, readPayload, reviewJson, sentBody, stepSummary, twoPasses, verdictJson,
  type Payload,
} from './harness'

installHooks()

describe('ai function: a verified review', () => {
  it('runs both passes and returns the comment kept, with the second pass reason and the quoted code', async () => {
    twoPasses([CRITICAL_DIVIDE, { ...CRITICAL_DIVIDE, line: 1, quote: 'def divide(a, b):', message: 'Name is vague.', suggestion: 'Rename it.', severity: 'info' }], [
      keep(1, 2, 'return a / b', 'return a / b divides with no guard for b equal to 0.'),
      { id: 2, verdict: 'drop', line: 1, evidence: 'def divide(a, b):', reason: 'divide is a clear name for def divide(a, b):.' },
    ])
    const res = await handler(post(DIVIDE_BODY))
    const payload = await readPayload(res)
    expect(res.status).toBe(200)
    expect(stepSummary(payload)).toEqual(COMPLETE)
    expect(payload.result).toMatchObject({ verified: true, malformed: 0, mode: 'file', pr: null, lineCount: 2, truncated: false })
    expect(payload.result?.comments).toMatchObject([
      { id: 1, line: 2, fromLine: 2, severity: 'critical', verdict: 'kept', decidedBy: 'verifier', evidence: 'return a / b', code: '    return a / b', reason: 'return a / b divides with no guard for b equal to 0.' },
      { id: 2, line: 1, verdict: 'dropped', decidedBy: 'verifier', evidence: 'def divide(a, b):' },
    ])
    expect(payload.trace[payload.trace.length - 1].detail).toBe('Every verdict checked against the code: 1 kept, 0 moved, 1 dropped, 0 not confirmed')
  })

  it('sums the tokens and cost of both passes, and gives every stage a start offset for the waterfall', async () => {
    twoPasses([CRITICAL_DIVIDE], [keep(1, 2, 'return a / b')])
    const payload = await readPayload(await handler(post(DIVIDE_BODY)))
    expect(payload.usage).toEqual({ prompt_tokens: 200, completion_tokens: 100, total_tokens: 300, cost: 0.0003 })
    expect(payload.trace.every((s) => typeof s.at === 'number')).toBe(true)
    expect(payload.trace[2]).toMatchObject({ tokens: 150, cost: 0.00015 })
    expect(payload.trace[5]).toMatchObject({ name: 'Pass 2: verify', tokens: 150 })
  })

  it('sends the review to pass 1 and the numbered code plus the comments to pass 2, both on the fixed model', async () => {
    twoPasses([CRITICAL_DIVIDE], [keep(1, 2, 'return a / b')])
    await handler(post({ ...DIVIDE_BODY, model: 'gpt-evil' }))
    expect(fetchStub).toHaveBeenCalledTimes(2)
    for (const call of [0, 1]) {
      const sent = sentBody(call)
      expect(sent).toMatchObject({ model: 'anthropic/claude-haiku-5.5', reasoning: { enabled: false }, usage: { include: true }, response_format: { type: 'json_object' } })
      expect(sent).not.toHaveProperty('temperature')
      expect(fetchStub.mock.calls[call][0]).toBe('https://openrouter.ai/api/v1/chat/completions')
    }
    expect(sentBody(0).messages[1].content).toContain('1\t| def divide(a, b):')
    const second = sentBody(1).messages
    expect(second[0].content).toContain('Check every comment against the code itself')
    expect(second[1].content).toContain('2\t|     return a / b')
    expect(second[1].content).toContain('"id": 1')
    expect(second[1].content).toContain('Dividing by zero raises ZeroDivisionError')
  })

  it('moves a comment to the line the second pass names when the quoted code is on that line', async () => {
    twoPasses([{ ...FIVE, line: 6, quote: '' }], [{ id: 1, verdict: 'move', line: 5, evidence: 'data = open(path).read()', reason: 'The unclosed handle is on line 5, not the return on line 6.' }])
    const payload = await readPayload(await handler(post(HOURS_BODY)))
    expect(payload.result?.comments[0]).toMatchObject({ verdict: 'moved', line: 5, fromLine: 6, decidedBy: 'verifier', code: '    data = open(path).read()' })
    expect(payload.trace[6].detail).toContain('1 moved')
  })

  it('shows a comment as not confirmed when the second pass quotes code that is not on the line it names', async () => {
    twoPasses([FIVE], [keep(1, 5, 'rows = load(sys.argv[1])')])
    const payload = await readPayload(await handler(post(HOURS_BODY)))
    expect(payload.result?.comments[0]).toMatchObject({ verdict: 'unverified', decidedBy: 'none', evidence: null, line: 5 })
    expect(payload.result?.comments[0].reason).toMatch(/not on line 5/)
    expect(payload.result?.verified).toBe(true)
  })

  it('never sends a comment the checks dropped to the second pass, and lists it with its reason', async () => {
    const leave = { line: 11, quote: 'os.exit(0)', severity: 'info', message: 'os.exit is deprecated and kept only for compatibility.', suggestion: 'Leave as-is for compatibility.', issue: true }
    twoPasses([FIVE, leave], [keep(1, 5, 'data = open(path).read()')])
    const payload = await readPayload(await handler(post(HOURS_BODY)))
    expect(sentBody(1).messages[1].content).not.toContain('os.exit is deprecated')
    expect(payload.result?.comments.map((c) => [c.id, c.verdict, c.decidedBy])).toEqual([[1, 'kept', 'verifier'], [2, 'dropped', 'check']])
    expect(payload.result?.comments[1].reason).toMatch(/^Concludes that nothing should change/)
  })

  it('drops a comment the model marked issue false, one that cites a line outside the file, and one with a quote that is not there', async () => {
    fetchStub.mockResolvedValueOnce(
      providerReply(reviewJson([FIVE, { ...FIVE, issue: false }, { ...FIVE, line: 99 }, { ...FIVE, quote: 'subprocess.run(cmd)', message: 'Shell injection risk.' }, { line: 'x' }])),
    )
    fetchStub.mockResolvedValueOnce(providerReply(verdictJson([keep(1, 5, 'data = open(path).read()')])))
    const payload = await readPayload(await handler(post(HOURS_BODY)))
    const reasons = payload.result?.comments.filter((c) => c.decidedBy === 'check').map((c) => c.reason)
    expect(reasons).toEqual([
      'The reviewer marked its own comment as not an issue.',
      'Cited line 99, which is outside the 12 numbered lines.',
      'The code it quotes ("subprocess.run(cmd)") is not on or near line 5.',
    ])
    expect(payload.result?.malformed).toBe(1)
  })

  it('skips the second pass, and says why, when the first pass wrote nothing', async () => {
    fetchStub.mockResolvedValueOnce(providerReply(reviewJson([])))
    const payload = await readPayload(await handler(post(DIVIDE_BODY)))
    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(stepSummary(payload)).toEqual(['Check request:ok', 'Build prompt:ok', 'Pass 1: review:ok', 'Parse reply:ok', 'Checks:ok', 'Pass 2: verify:skipped', 'Re-validate:ok'])
    expect(payload.result).toMatchObject({ comments: [], verified: true })
  })

  it('shows every surviving comment as unverified when the second pass fails, and says the pass did not finish', async () => {
    fetchStub.mockResolvedValueOnce(providerReply(reviewJson([FIVE])))
    fetchStub.mockResolvedValueOnce(new Response('upstream exploded', { status: 500 }))
    const res = await handler(post(HOURS_BODY))
    const payload = await readPayload(res)
    expect(res.status).toBe(200)
    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect(payload.result).toMatchObject({ verified: false })
    expect(payload.result?.comments[0]).toMatchObject({ verdict: 'unverified', decidedBy: 'none' })
    expect(stepSummary(payload).slice(5)).toEqual(['Pass 2: verify:failed', 'Re-validate:ok'])
    expect(payload.trace[5].detail).toBe('Provider failed (HTTP 500) (limit 10.8 s)')
  })

  it('retries a second-pass reply that is not a list of verdicts once, and then calls the pass failed', async () => {
    fetchStub.mockResolvedValueOnce(providerReply(reviewJson([FIVE])))
    fetchStub.mockResolvedValueOnce(providerReply('I think the comment is fine.'))
    fetchStub.mockResolvedValueOnce(providerReply('Still fine, I think.'))
    const payload = await readPayload(await handler(post(HOURS_BODY)))
    expect(payload.result?.verified).toBe(false)
    expect(stepSummary(payload).slice(5)).toEqual(['Pass 2: verify:ok', 'Pass 2: verify retry:failed', 'Re-validate:ok'])
    expect(payload.trace[6].detail).toContain('not a readable list of verdicts')
  })

  it('reads the bare array the live model returns, and an object with a verdicts key', async () => {
    fetchStub.mockResolvedValueOnce(providerReply(reviewJson([FIVE])))
    fetchStub.mockResolvedValueOnce(providerReply(JSON.stringify({ verdicts: [keep(1, 5, 'data = open(path).read()')] })))
    const payload = await readPayload(await handler(post(HOURS_BODY)))
    expect(payload.result?.comments[0].verdict).toBe('kept')
  })
})

describe('ai function: the first pass and its retry', () => {
  it('retries a second pass that was cut short, and uses the retry when it is a good list', async () => {
    fetchStub.mockResolvedValueOnce(providerReply(reviewJson([FIVE])))
    fetchStub.mockResolvedValueOnce(providerReply('[{"id":1,"verdict":"ke', 'length'))
    fetchStub.mockResolvedValueOnce(providerReply(verdictJson([keep(1, 5, 'data = open(path).read()')])))
    const payload = await readPayload(await handler(post(HOURS_BODY)))
    expect(payload.result).toMatchObject({ verified: true })
    expect(stepSummary(payload).slice(5)).toEqual(['Pass 2: verify:ok', 'Pass 2: verify retry:ok', 'Re-validate:ok'])
    expect(payload.trace[5].detail).toContain('but it was cut short')
  })

  it('retries a second pass that answers for only some of the comments, and keeps the retry when it is complete', async () => {
    const second = { ...FIVE, line: 6, quote: 'data.split', message: 'split(",") breaks on quoted commas.', suggestion: 'Use the csv module.' }
    fetchStub.mockResolvedValueOnce(providerReply(reviewJson([FIVE, second])))
    fetchStub.mockResolvedValueOnce(providerReply(verdictJson([keep(1, 5, 'data = open(path).read()')])))
    fetchStub.mockResolvedValueOnce(providerReply(verdictJson([keep(1, 5, 'data = open(path).read()'), keep(2, 6, 'return data.split(",")')])))
    const payload = await readPayload(await handler(post(HOURS_BODY)))
    expect(payload.result?.comments.map((c) => c.verdict)).toEqual(['kept', 'kept'])
    expect(payload.trace[5].detail).toContain('but it was missing 1 of 2 verdicts')
    expect(stepSummary(payload).slice(5)).toEqual(['Pass 2: verify:ok', 'Pass 2: verify retry:ok', 'Re-validate:ok'])
  })

  it('shows the comments a second pass skipped as not confirmed when the retry skips them too', async () => {
    const second = { ...FIVE, line: 6, quote: 'data.split', message: 'split(",") breaks on quoted commas.', suggestion: 'Use the csv module.' }
    fetchStub.mockResolvedValueOnce(providerReply(reviewJson([FIVE, second])))
    fetchStub.mockImplementation(async () => providerReply(verdictJson([keep(1, 5, 'data = open(path).read()')])))
    const payload = await readPayload(await handler(post(HOURS_BODY)))
    expect(payload.result?.comments.map((c) => [c.verdict, c.reason])).toEqual([
      ['kept', 'The code does what the comment says.'],
      ['unverified', 'The second pass gave no verdict for this comment.'],
    ])
  })

  it('retries once when the first reply is empty, and sums usage across all three calls', async () => {
    fetchStub.mockResolvedValueOnce(providerReply(''))
    fetchStub.mockResolvedValueOnce(providerReply(reviewJson([CRITICAL_DIVIDE])))
    fetchStub.mockResolvedValueOnce(providerReply(verdictJson([keep(1, 2, 'return a / b')])))
    const payload = await readPayload(await handler(post(DIVIDE_BODY)))
    expect(stepSummary(payload)).toEqual(['Check request:ok', 'Build prompt:ok', 'Pass 1: review:ok', 'Pass 1: review retry:ok', 'Parse reply:ok', 'Checks:ok', 'Pass 2: verify:ok', 'Re-validate:ok'])
    expect(payload.trace[2].detail).toContain('but it was empty')
    expect(payload.trace[3].detail).toContain('Retried once because the first reply was empty')
    expect(payload.usage?.total_tokens).toBe(450)
  })

  it('retries once when the first reply was cut short, and reports a review cut short twice as cut short', async () => {
    fetchStub.mockResolvedValueOnce(providerReply('{"comments": [{"line": 2, "sev', 'length'))
    fetchStub.mockResolvedValueOnce(providerReply('{"comments": [{"line": 2, "sev', 'length'))
    const res = await handler(post(DIVIDE_BODY))
    const payload = await readPayload(res)
    expect(res.status).toBe(502)
    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect(payload.error).toBe('The review was cut short before it could be read. Try a shorter snippet.')
    expect(stepSummary(payload).slice(2, 4)).toEqual(['Pass 1: review:ok', 'Pass 1: review retry:ok'])
  })

  it('retries once after a lost connection, and shows the failed try and the retry in the trace', async () => {
    fetchStub.mockRejectedValueOnce(new TypeError('fetch failed'))
    fetchStub.mockResolvedValueOnce(providerReply(reviewJson([CRITICAL_DIVIDE])))
    fetchStub.mockResolvedValueOnce(providerReply(verdictJson([keep(1, 2, 'return a / b')])))
    const res = await handler(post(DIVIDE_BODY))
    const payload = await readPayload(res)
    expect(res.status).toBe(200)
    expect(stepSummary(payload).slice(2, 4)).toEqual(['Pass 1: review:failed', 'Pass 1: review retry:ok'])
    expect(payload.trace[3].detail).toContain('Retried once after: Could not reach the provider')
  })

  it('answers 502 when the retry also loses the connection, after exactly two tries', async () => {
    fetchStub.mockRejectedValue(new TypeError('fetch failed'))
    const res = await handler(post(DIVIDE_BODY))
    expect(res.status).toBe(502)
    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect((await readPayload(res)).error).toBe('Could not reach the AI provider. Try again in a moment.')
  })

  it.each([401, 402, 429, 500, 503])('never retries a provider %i', async (status) => {
    fetchStub.mockResolvedValue(new Response('{"error":"no"}', { status }))
    await handler(post(DIVIDE_BODY))
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('retries once when the reply is complete but is not a readable review, then answers 502', async () => {
    fetchStub.mockResolvedValueOnce(providerReply('I looked and it seems fine.'))
    fetchStub.mockResolvedValueOnce(providerReply('Still no JSON, sorry.'))
    const res = await handler(post(DIVIDE_BODY))
    const payload = await readPayload(res)
    expect(res.status).toBe(502)
    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect(payload.error).toBe('The AI response could not be read. Please try again.')
    expect(payload.trace[3].detail).toContain('Retried once because the first reply was not a readable JSON review')
  })

  it('reads a bare array of comments as the review, and still drops an item with no message or severity', async () => {
    fetchStub.mockResolvedValueOnce(providerReply(JSON.stringify([CRITICAL_DIVIDE, { line: 2 }])))
    fetchStub.mockResolvedValueOnce(providerReply(verdictJson([keep(1, 2, 'return a / b')])))
    const payload = await readPayload(await handler(post(DIVIDE_BODY)))
    expect(payload.result?.comments).toHaveLength(1)
    expect(payload.result?.malformed).toBe(1)
  })

  it('recovers when the retry of an unreadable first reply is a good review', async () => {
    fetchStub.mockResolvedValueOnce(providerReply('{"comments": [oops'))
    fetchStub.mockResolvedValueOnce(providerReply(reviewJson([CRITICAL_DIVIDE])))
    fetchStub.mockResolvedValueOnce(providerReply(verdictJson([keep(1, 2, 'return a / b')])))
    const payload = await readPayload(await handler(post(DIVIDE_BODY)))
    expect(payload.result?.comments[0].verdict).toBe('kept')
    expect(payload.trace[2].detail).toContain('but it was not a readable JSON review')
  })

  it('answers 500 with a fixed message, hides the detail and marks the stage that broke', async () => {
    const broken = { ok: true, json: async () => ({ get choices(): never { throw new Error('boom: secret detail') } }) } as unknown as Response
    fetchStub.mockResolvedValueOnce(broken)
    const res = await handler(post(DIVIDE_BODY))
    const text = await res.text()
    const payload = JSON.parse(text) as Payload
    expect(res.status).toBe(500)
    expect(payload.error).toBe('Something went wrong on the server. Please try again.')
    expect(text).not.toContain('secret detail')
    expect(payload.trace.find((s) => s.status === 'failed')).toMatchObject({ name: 'Pass 1: review', detail: 'Unexpected server error' })
  })
})
