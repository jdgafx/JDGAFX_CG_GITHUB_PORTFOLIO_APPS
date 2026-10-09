import { describe, expect, it, vi } from 'vitest'
import handler, { config } from '../../netlify/functions/ai'
import { CONTENT_TYPES, STAGE_LABELS } from '../../netlify/shared/contract'
import { SITE_URL } from '../../netlify/shared/provider'
import {
  ARTICLE, CUT_OFF_MESSAGE, EMPTY_MESSAGE, KEY_MESSAGE, LABEL_MESSAGE, NOTES, PLACEHOLDER, RATE_MESSAGE, SHORT_MESSAGE, SLOW_MESSAGE, SOURCES, TOPIC,
  completion, providerWill, request, stageBody, installFunctionHarness, words, type ErrorBody, type Sent, type StageBody,
} from './harness'

installFunctionHarness()

describe('happy path', () => {
  it('returns the stage text, the served model, the usage and one Research trace row', async () => {
    const sent = providerWill(() => completion(`  ${ARTICLE}  `))

    const res = await handler(request(stageBody('research')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as StageBody
    expect(body.result).toBe(ARTICLE.trim())
    expect(body.model).toBe('anthropic/claude-haiku-5.5')
    expect(body.usage?.total_tokens).toBe(1200)
    expect(body.trace).toHaveLength(1)
    expect(body.trace[0]).toMatchObject({ name: 'Research', status: 'ok', tokens: 1200, cost: 0.0002 })
    expect(String(body.trace[0].detail)).toMatch(/^160 words: Unit tests give/)
    expect(sent).toHaveLength(1)
  })

  it('sends the fixed model, a ceiling of five tokens per budget word and usage reporting, whatever model the browser names', async () => {
    const sent = providerWill(() => completion(ARTICLE))

    await handler(request(stageBody('research', {}, { model: 'openai/gpt-4o' })))
    expect(sent[0].url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(sent[0].body.model).toBe('anthropic/claude-haiku-5.5')
    expect(sent[0].body.max_tokens).toBe(400)
    expect(sent[0].body.usage).toEqual({ include: true })
    expect(sent[0].body.stream).toBe(false)
    expect(sent[0].init?.headers).toMatchObject({ Authorization: `Bearer ${PLACEHOLDER}` })
  })

  it.each([['research', 400], ['outline', 500], ['draft', 800], ['edit', 1020], ['polish', 1020]])('limits %s to %i tokens (edit and polish add room for their change notes)', async (stage, tokens) => {
    const sent = providerWill(() => completion(ARTICLE))
    await handler(request(stageBody(stage, { research: NOTES, outline: '- P', draft: ARTICLE, edit: ARTICLE })))
    expect(sent[0].body.max_tokens).toBe(tokens)
  })

  it('sends the whole Draft to Edit, however long, and refuses an Edit that stops mid-word', async () => {
    const longDraft = Array.from({ length: 40 }, (_, i) => `Sentence number ${i + 1} says something specific about the telescope.`).join(' ')
    const sent = providerWill(() => completion(`${longDraft.slice(0, 1_850)}fi`))
    const res = await handler(request(stageBody('edit', { outline: '- P', draft: longDraft })))
    const message = (sent[0].body.messages as Array<{ content: string }>)[1].content
    expect(message).toContain(`## Draft\n${longDraft}\n\n`)
    expect(message).not.toContain('[truncated]')
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'This stage stopped in the middle of a sentence, so it was discarded.', retryable: true })
  })

  it('sends the Draft prompt with the research and the outline attached', async () => {
    const sent = providerWill(() => completion(ARTICLE))

    await handler(request(stageBody('draft', { research: NOTES, outline: '- Why tests pay off' })))
    const messages = sent[0].body.messages as Array<{ role: string; content: string }>
    expect(messages[0].content).toContain('Current step: DRAFT.')
    expect(messages[0].content).toContain('roughly 160 words')
    expect(messages[0].content).toContain('put its number in square brackets')
    expect(messages[1].content).toContain(`## Sources\n${SOURCES}`)
    expect(messages[1].content).toContain(`## Research\n${NOTES}`)
    expect(messages[1].content).toContain('## Outline\n- Why tests pay off')
    expect(messages[1].content).toMatch(/draft the Blog Post about: Why unit tests matter for small teams$/)
  })

  it.each([...CONTENT_TYPES])('accepts the %s content type', async contentType => {
    providerWill(() => completion(ARTICLE))
    const res = await handler(request(stageBody('draft', { research: NOTES, outline: '- Point' }, { contentType })))
    expect(res.status).toBe(200)
  })
})

describe('request validation', () => {
  it('answers 405 to a GET and calls no provider', async () => {
    const res = await handler(request(undefined, { method: 'GET' }))
    expect(res.status).toBe(405)
    expect(await res.text()).toBe('Method not allowed')
  })

  it('answers the preflight request with 204', async () => {
    const res = await handler(request(undefined, { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
  })

  it('refuses an origin that is not the site', async () => {
    const res = await handler(request(stageBody('research'), { origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(await res.text()).toBe('Origin not allowed')
  })

  it('answers 500 and calls no provider when the key is not set', async () => {
    process.env.OPENROUTER_API_KEY = ''
    const res = await handler(request(stageBody('research')))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'The AI provider is not set up for this site.', retryable: false })
  })

  const invalidBodies: Array<[string, unknown, string]> = [
    ['an unknown content type', stageBody('research', {}, { contentType: 'Poem' }), 'Choose a content type from the list.'],
    ['a missing content type', { topic: TOPIC, stage: 'research', context: {} }, 'Choose a content type from the list.'],
    ['an empty topic', stageBody('research', {}, { topic: '   ' }), 'Enter a topic first.'],
    ['a topic over 400 characters', stageBody('research', {}, { topic: 'a'.repeat(401) }), 'Keep the topic to 400 characters or fewer.'],
    ['an unknown stage', stageBody('publish'), 'Unknown stage. Expected one of: sources, research, outline, draft, edit, polish.'],
    ['a draft with no outline', stageBody('draft', { research: NOTES }), 'The Draft stage needs the Outline output first.'],
    ['research with no sources', stageBody('research', { sources: '  ' }), 'The Research stage needs the Sources output first.'],
    ['a stage output that is not text', stageBody('outline', { research: 42 }), 'The Research output is not valid.'],
    ['a stage output over 8,000 characters', stageBody('outline', { research: 'x'.repeat(8_001) }), 'The Research output is not valid.'],
    ['stage outputs that are not an object', { ...stageBody('research'), context: 'notes' }, 'The stage outputs must be a JSON object.'],
    ['a body that is a list', ['research'], 'The request body must be a JSON object.'],
  ]

  it.each(invalidBodies)('refuses %s with a plain message and calls no provider', async (_label, body, message) => {
    const res = await handler(request(body))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: message, retryable: false })
  })

  it('refuses a body that is not JSON', async () => {
    const res = await handler(request(undefined, { rawBody: '{not json' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'The request is not valid JSON.', retryable: false })
  })

  it('refuses a body larger than 128 KB once it has been read', async () => {
    const res = await handler(request(stageBody('research', {}, { padding: 'x'.repeat(140_000) })))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'The request is too large.', retryable: false })
  })

  it('refuses a body whose declared length is over the limit before reading it', async () => {
    const res = await handler(request(undefined, { rawBody: '{}', headers: { 'content-length': '999999' } }))
    expect(res.status).toBe(413)
  })

  it('refuses the 31st run from one client within a minute', async () => {
    const headers = { 'x-nf-client-connection-ip': '198.51.100.77' }
    for (let i = 0; i < 30; i += 1) {
      expect((await handler(request({}, { headers }))).status).toBe(400)
    }
    const res = await handler(request({}, { headers }))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'Too many runs from this connection. Wait a minute and try again.', retryable: false })
  })

  it('answers with a generic 500 when the request body cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken = request(stageBody('research'))
    Object.defineProperty(broken, 'text', { value: () => Promise.reject(new Error('stream failed')) })
    const res = await handler(broken)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Something went wrong on the server. Try again.', retryable: false })
  })
})

describe('provider failures', () => {
  it('maps a 402 to the key-or-credit message and never copies the provider body', async () => {
    providerWill(() => new Response('{"error":"acct_secret_9 has no credit"}', { status: 402 }))
    const res = await handler(request(stageBody('research')))
    const text = await res.text()
    expect(res.status).toBe(502)
    expect(text).toContain(KEY_MESSAGE)
    expect(text).not.toContain('acct_secret_9')
  })

  it('maps a 401 to the key-or-credit message', async () => {
    providerWill(() => new Response('{}', { status: 401 }))
    const res = await handler(request(stageBody('research')))
    expect(await res.json()).toEqual({ error: KEY_MESSAGE, retryable: false, trace: expect.any(Array), totalMs: expect.any(Number), usage: null, model: null })
  })

  it('maps a provider 500 to the slow message without showing the provider text', async () => {
    providerWill(() => new Response('{"error":"leaked-detail"}', { status: 500 }))
    const res = await handler(request(stageBody('research')))
    const text = await res.text()
    expect(res.status).toBe(502)
    expect(text).toContain(SLOW_MESSAGE)
    expect(text).not.toContain('leaked-detail')
  })

  it('maps a provider 429 to the rate-limit message', async () => {
    providerWill(() => new Response('{}', { status: 429 }))
    const res = await handler(request(stageBody('research')))
    expect(res.status).toBe(429)
    expect(((await res.json()) as ErrorBody).error).toBe(RATE_MESSAGE)
  })

  it('treats a provider reply that is not JSON as a failed stage that is not retried', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    providerWill(() => new Response('<html>not json</html>', { status: 200 }))
    const res = await handler(request(stageBody('research')))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({
      error: 'Could not get a usable answer from the AI provider. Try again.',
      retryable: false,
    })
  })

  it('maps a provider AbortError to the timeout message with status 504', async () => {
    providerWill(() => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    })
    const res = await handler(request(stageBody('research')))
    expect(res.status).toBe(504)
    expect(await res.json()).toMatchObject({ error: SLOW_MESSAGE, retryable: false })
  })

  // The call limit of each stage: about 1.5 times the p95 of healthy calls over 32 live runs on Haiku 5.5.
  const LIMITS: Array<[string, number]> = [['research', 6_000], ['outline', 8_000], ['draft', 10_000], ['edit', 7_000], ['polish', 9_000]]
  const context = { research: NOTES, outline: '- P', draft: ARTICLE, edit: ARTICLE }
  const hangs = (call: Sent) => new Promise<Response>((_resolve, reject) => {
    call.init?.signal?.addEventListener('abort', () => reject(call.init?.signal?.reason))
  })

  it.each(LIMITS)('lets the %s call run until %i ms and abandons it then', async (stage, limit) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const sent = providerWill(hangs)

    const pending = handler(request(stageBody(stage, context)))
    await vi.advanceTimersByTimeAsync(limit - 1)
    expect(sent).toHaveLength(1)
    expect(sent[0].init?.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(sent[0].init?.signal?.aborted).toBe(true)
    // The second attempt starts at once, with its own full limit.
    expect(sent).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(limit)

    const res = await pending
    expect(res.status).toBe(504)
    const body = (await res.json()) as ErrorBody
    expect(body.error).toBe(SLOW_MESSAGE)
    expect(body.retryable).toBe(false)
    expect(body.trace?.[0]).toMatchObject({ status: 'failed', detail: `${SLOW_MESSAGE} Retried once after a timeout of ${limit / 1000} s.` })
    expect(sent).toHaveLength(2)
  })

  it.each(LIMITS)('answers the %s stage with one retry row when the first call hangs and the second answers', async (stage, limit) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let calls = 0
    const sent = providerWill(call => {
      calls += 1
      return calls === 1 ? hangs(call) : completion(ARTICLE)
    })

    const pending = handler(request(stageBody(stage, context)))
    await vi.advanceTimersByTimeAsync(limit)

    const res = await pending
    expect(res.status).toBe(200)
    const body = (await res.json()) as StageBody
    expect(body.trace).toHaveLength(1)
    expect(body.trace[0]).toMatchObject({ name: STAGE_LABELS[stage as 'research'], status: 'ok', tokens: 1200 })
    expect(String(body.trace[0].detail)).toMatch(new RegExp(`^Retried once after a timeout of ${limit / 1000} s\\. (?:No change notes came back\\. )?\\d+ words: `))
    expect(sent).toHaveLength(2)
  })

  it('also ends a call whose body never finishes at the limit and retries it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let calls = 0
    const sent = providerWill(() => {
      calls += 1
      return calls === 1
        ? new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200, headers: { 'content-type': 'application/json' } })
        : completion(ARTICLE)
    })

    const pending = handler(request(stageBody('research')))
    await vi.advanceTimersByTimeAsync(6_000)
    expect((await pending).status).toBe(200)
    expect(sent).toHaveLength(2)
  })

  it('retries a call that could not connect once, and says so', async () => {
    let calls = 0
    const sent = providerWill(() => {
      calls += 1
      if (calls === 1) throw new TypeError('fetch failed')
      return completion(ARTICLE)
    })
    const res = await handler(request(stageBody('research')))
    expect(res.status).toBe(200)
    expect(String(((await res.json()) as StageBody).trace[0].detail)).toMatch(/^Retried once after a connection failure\. /)
    expect(sent).toHaveLength(2)
  })

  it('gives up after a second connection failure with the plain message and the note', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const sent = providerWill(() => {
      throw new TypeError('fetch failed')
    })
    const res = await handler(request(stageBody('research')))
    expect(res.status).toBe(502)
    const body = (await res.json()) as ErrorBody
    expect(body.error).toBe('Could not get a usable answer from the AI provider. Try again.')
    expect(body.trace?.[0].detail).toBe(`${body.error} Retried once after a connection failure.`)
    expect(sent).toHaveLength(2)
  })

  it.each([[400], [401], [402], [403], [429], [500], [503]])('makes exactly one call when the provider answers HTTP %i', async status => {
    const sent = providerWill(() => new Response('{}', { status }))
    await handler(request(stageBody('research')))
    expect(sent).toHaveLength(1)
  })

  it('makes exactly one call for a reply that is not JSON, an empty reply and a refused reply', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const respond of [() => new Response('<html></html>', { status: 200 }), () => completion('   '), () => completion('User Safety: safe')]) {
      const sent = providerWill(respond)
      await handler(request(stageBody('research')))
      expect(sent).toHaveLength(1)
    }
  })

  it('does not retry when the browser stops the run', async () => {
    const controller = new AbortController()
    const sent = providerWill(call => {
      controller.abort()
      return hangs(call)
    })
    const req = new Request('https://example.test/api/ai', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', origin: SITE_URL, 'x-nf-client-connection-ip': '203.0.113.201' },
      body: JSON.stringify(stageBody('research')),
    })
    const res = await handler(req)
    expect(res.status).toBe(503)
    expect(sent).toHaveLength(1)
  })
})

describe('output checks', () => {
  it('rejects a moderation label from an ordinary model with a plain message', async () => {
    providerWill(() => completion('User Safety: safe'))
    const res = await handler(request(stageBody('research')))
    expect(res.status).toBe(502)
    const body = (await res.json()) as ErrorBody
    expect(body.error).toBe(LABEL_MESSAGE)
    expect(body.retryable).toBe(false)
    expect(body.trace?.[0]).toMatchObject({ name: 'Research', status: 'failed', detail: LABEL_MESSAGE })
  })

  it('rejects a reply served by a content-safety model', async () => {
    providerWill(() => completion(ARTICLE, { model: 'nvidia/nemotron-3.5-content-safety:free' }))
    const res = await handler(request(stageBody('draft', { research: NOTES, outline: '- Point' })))
    expect(((await res.json()) as ErrorBody).error).toBe(LABEL_MESSAGE)
  })

  it('rejects a Polish that is under 70% of the length of the Edit it was given', async () => {
    providerWill(() => completion(words(60)))
    const res = await handler(request(stageBody('polish', { edit: words(100) })))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: SHORT_MESSAGE, retryable: true })
  })

  it('accepts a Polish that keeps 70% of the Edit', async () => {
    providerWill(() => completion(words(70)))
    const res = await handler(request(stageBody('polish', { edit: words(100) })))
    expect(res.status).toBe(200)
    const { result } = (await res.json()) as StageBody
    expect(result.startsWith(words(70))).toBe(true)
  })

  it('rejects an Edit that is under 70% of the length of the Draft', async () => {
    providerWill(() => completion(words(20)))
    const res = await handler(request(stageBody('edit', { outline: '- Point', draft: words(100) })))
    expect(await res.json()).toMatchObject({
      error: 'This stage returned far less text than the Draft stage it was given, so it was discarded.',
      retryable: true,
    })
  })

  it('rejects an empty reply and marks it for one retry', async () => {
    providerWill(() => completion('   '))
    const res = await handler(request(stageBody('research')))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: EMPTY_MESSAGE, retryable: true })
  })

  it('rejects a reply cut off by the token limit, keeps the tokens it used, and marks it for one retry', async () => {
    providerWill(() => completion(ARTICLE, { choices: [{ message: { content: ARTICLE }, finish_reason: 'length' }] }))
    const res = await handler(request(stageBody('research')))
    const body = (await res.json()) as ErrorBody
    expect(body.error).toBe(CUT_OFF_MESSAGE)
    expect(body.retryable).toBe(true)
    expect(body.trace?.[0]).toMatchObject({ tokens: 1200, cost: 0.0002 })
  })

  it('rejects a reply of fewer than five words', async () => {
    providerWill(() => completion('Too short'))
    const res = await handler(request(stageBody('research')))
    expect(await res.json()).toMatchObject({ error: 'This stage returned too little text to use.', retryable: true })
  })

  it('refuses output too long for the next stage to accept, with no retry', async () => {
    providerWill(() => completion(words(2_000)))
    const res = await handler(request(stageBody('research')))
    expect(await res.json()).toMatchObject({
      error: 'This stage wrote more text than the next stage can take, so it was discarded.',
      retryable: false,
    })
  })
})

describe('usage and trace', () => {
  it('returns null usage and no token figures when the provider reports none', async () => {
    providerWill(() => completion(ARTICLE, { usage: undefined }))
    const body = (await (await handler(request(stageBody('research')))).json()) as StageBody
    expect(body.usage).toBeNull()
    expect(body.trace[0]).not.toHaveProperty('tokens')
    expect(body.trace[0]).not.toHaveProperty('cost')
  })

  it('reports tokens but no cost when the provider sends no cost', async () => {
    providerWill(() => completion(ARTICLE, { usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 } }))
    const body = (await (await handler(request(stageBody('research')))).json()) as StageBody
    expect(body.usage).toEqual({ prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 })
    expect(body.trace[0]).toMatchObject({ tokens: 1200 })
    expect(body.trace[0]).not.toHaveProperty('cost')
  })
})

describe('contract', () => {
  it('serves the function at /api/ai', () => {
    expect(config.path).toBe('/api/ai')
  })
})
