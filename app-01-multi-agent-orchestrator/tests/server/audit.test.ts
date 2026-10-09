import { describe, expect, it } from 'vitest'
import handler from '../../netlify/functions/audit'
import { FIXED_MODEL, PROVIDER_TIMEOUT, SITE, installHarness, refuse, request, stubFetch } from './helpers'

installHarness()

const JWST =
  'The James Webb Space Telescope (JWST) is a space telescope designed to conduct infrared astronomy. Its 6.5 meter primary mirror lets it see objects too old and distant for Hubble.'
const SOURCES = [{ n: 1, title: 'James Webb Space Telescope', site: 'Wikipedia', snippet: JWST }]
const REPORT = [
  'JWST is built for infrared astronomy [1].',
  'Its primary mirror is 9 metres wide [1].',
  'Bananas are rich in potassium and grow in tropical regions [1].',
  '',
  '### Sources',
  '',
  '1. [James Webb Space Telescope](https://en.wikipedia.org/wiki/James_Webb_Space_Telescope) - Wikipedia',
].join('\n')

function modelReply(text: string, usage = { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380, cost: 0.0004 }): () => Response {
  return () =>
    new Response(
      [{ model: 'anthropic/claude-haiku-5.5', choices: [{ delta: { content: text } }] }, { model: 'anthropic/claude-haiku-5.5', choices: [{ delta: {}, finish_reason: 'stop' }], usage }]
        .map(value => `data: ${JSON.stringify(value)}\n\n`)
        .join('') + 'data: [DONE]\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )
}

const body = (report = REPORT) => JSON.stringify({ report, sources: SOURCES })

describe('audit function', () => {
  it('judges the cited sentences with one model call, verifies the quote, and decides a no-overlap sentence without the model', async () => {
    const fetchMock = stubFetch(() => {
      throw new Error('unused')
    })
    fetchMock.mockImplementation(async (_url, init) => {
      const sent = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ content: string }>; temperature?: number }
      expect(sent.model).toBe(FIXED_MODEL)
      expect('temperature' in sent).toBe(false)
      // The banana sentence shares no word with the source, so only two claims go to the model.
      expect(sent.messages[1]?.content).toContain('1. JWST is built for infrared astronomy [1].')
      expect(sent.messages[1]?.content).toContain('2. Its primary mirror is 9 metres wide [1].')
      expect(sent.messages[1]?.content).not.toContain('Bananas')
      return modelReply(
        '{"results":[{"id":1,"verdict":"supported","source":1,"quote":"designed to conduct infrared astronomy","reason":"Stated."},{"id":2,"verdict":"supported","source":1,"quote":"Its 6.5 meter primary mirror lets it see objects","reason":"Mirror size stated."}]}',
      )()
    })

    const res = await handler(request(body()))
    expect(res.status).toBe(200)
    const result = (await res.json()) as {
      claims: Array<{ id: number; verdict: string; reason: string; quote?: { n: number; text: string }; pre: { missingNumbers: string[] } }>
      summary: Record<string, number>
      usage: { total_tokens: number }
      model: string
    }

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.claims.map(claim => [claim.id, claim.verdict])).toEqual([
      [1, 'supported'],
      [2, 'partly'], // the model said supported, but 9 is in no source text
      [3, 'unsupported'], // decided by the pre-pass
    ])
    expect(result.claims[0]?.quote).toMatchObject({ n: 1, text: 'designed to conduct infrared astronomy' })
    expect(result.claims[1]?.reason).toContain('does not contain 9')
    expect(result.claims[2]?.reason).toBe('It shares no content word with the source it cites.')
    expect(result.summary).toEqual({ total: 3, supported: 1, partly: 1, unsupported: 1, unchecked: 0 })
    expect(result.usage.total_tokens).toBe(380)
    expect(result.model).toBe('anthropic/claude-haiku-5.5')
  })

  it('shows a sentence the model skipped as not checked, and a made-up quote as partly supported', async () => {
    stubFetch(() =>
      modelReply('{"results":[{"id":1,"verdict":"supported","source":1,"quote":"it was launched in the year 2021 by NASA","reason":"x"}]}')(),
    )
    const res = await handler(request(body()))
    const result = (await res.json()) as { claims: Array<{ verdict: string; quote?: unknown; reason: string }> }
    expect(result.claims.map(claim => claim.verdict)).toEqual(['partly', 'unchecked', 'unsupported'])
    expect(result.claims[0]?.quote).toBeUndefined()
    expect(result.claims[0]?.reason).toContain('not in the source text')
  })

  it('makes no model call when every sentence is decided by the pre-pass', async () => {
    const fetchMock = stubFetch(() => modelReply('{}')())
    const res = await handler(request(body('Bananas are rich in potassium [1].')))
    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    const result = (await res.json()) as { summary: Record<string, number> }
    expect(result.summary).toMatchObject({ total: 1, unsupported: 1 })
  })

  it('retries a hung model call once and reports it', async () => {
    let calls = 0
    stubFetch(() => {
      calls += 1
      if (calls === 1) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      return modelReply('{"results":[{"id":1,"verdict":"unsupported","reason":"Not stated."}]}')()
    })
    const res = await handler(request(body('JWST is built for infrared astronomy [1].')))
    const result = (await res.json()) as { retried?: string; claims: Array<{ verdict: string }> }
    expect(calls).toBe(2)
    expect(result.retried).toBe('timeout')
    expect(result.claims[0]?.verdict).toBe('unsupported')
  })

  it('answers a provider failure with a plain message and no provider detail', async () => {
    stubFetch(refuse(500, 'upstream exploded'))
    const res = await handler(request(body('JWST is built for infrared astronomy [1].')))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: PROVIDER_TIMEOUT })
  }, 20_000)

  it('refuses a reply with no usable verdicts', async () => {
    stubFetch(() => modelReply('Sorry, I cannot do that.')())
    const res = await handler(request(body('JWST is built for infrared astronomy [1].')))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'The audit model returned no usable verdicts. Try again.' })
  })

  it('checks method, origin, body and rate limit before any model call', async () => {
    const fetchMock = stubFetch(() => modelReply('{}')())
    expect((await handler(request(undefined, { method: 'GET' }))).status).toBe(405)
    expect((await handler(request(body(), { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await handler(request(body(), { method: 'OPTIONS' }))).status).toBe(204)
    expect((await handler(request('{"report":"x"}'))).status).toBe(400)
    const ip = '203.0.113.9'
    for (let i = 0; i < 10; i += 1) await handler(request('{}', { ip }))
    const limited = await handler(request('{}', { ip }))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).not.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(SITE).toBe('https://site.example')
  })
})
