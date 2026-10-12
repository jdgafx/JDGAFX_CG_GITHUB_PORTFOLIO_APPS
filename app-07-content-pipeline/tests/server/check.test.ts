import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { completion, installFunctionHarness, request } from './harness'

type Handler = (req: Request) => Promise<Response>
let handler: Handler

installFunctionHarness()

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('../../netlify/functions/check')).default
})

afterEach(() => {
  vi.useRealTimers()
})

const LIST_URL = 'https://openrouter.ai/api/v1/models'
const NEWEST = 'anthropic/claude-haiku-5.5'
const SUNSHIELD =
  'The James Webb Space Telescope (JWST) sunshield is a passive thermal control system deployed post-launch to shield the telescope and instrumentation from the light and heat of the Sun, Earth, and Moon. Its intricate deployment was successfully completed on January 4, 2022, ten days after launch, when it was more than 0.8 million kilometers (500,000 mi) away from Earth.'
const SOURCES = [
  '[1] Wikipedia: James Webb Space Telescope sunshield',
  'URL: https://en.wikipedia.org/wiki/James_Webb_Space_Telescope_sunshield',
  `Summary: ${SUNSHIELD}`,
  '',
  '[2] Hacker News: A headline only',
  'URL: https://news.ycombinator.com/item?id=1',
  'Points: 10',
].join('\n')
const PLANTED = 'Once in place, the telescope settled into its operating position, more than 0.8 million kilometers from Earth [1].'
const CONTROL = 'Its intricate deployment was completed on January 4, 2022, ten days after launch [1].'
const SPAN = 'when it was more than 0.8 million kilometers (500,000 mi) away from Earth'
const CONTROL_SPAN = 'successfully completed on January 4, 2022, ten days after launch'

interface Answer {
  id: number
  source_supports?: string
  subject_matches?: string
  cause_matches?: string
  all_parts_covered?: string
  spans?: Array<{ source: number; text: string }>
  [key: string]: unknown
}

const answer = (id: number, overrides: Partial<Answer> = {}): Answer => ({
  id, source_supports: 'yes', subject_matches: 'yes', cause_matches: 'not_applicable', all_parts_covered: 'yes', spans: [{ source: 1, text: CONTROL_SPAN }], uncovered: '', reason: 'ok', ...overrides,
})

// The claim numbers a provider call was asked about, read from its user message.
function idsAsked(body: Record<string, unknown>): number[] {
  const messages = body.messages as Array<{ role: string; content: string }>
  const user = messages.find(message => message.role === 'user')?.content ?? ''
  return [...user.matchAll(/^(\d+)\. /gm)].map(match => Number(match[1]))
}

interface Sent { url: string; body: Record<string, unknown> }

// The model list names NEWEST; each provider call is answered by `reply`.
function provider(reply: (ids: number[], call: number) => Response | Promise<Response>): Sent[] {
  const sent: Sent[] = []
  let call = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === LIST_URL) {
      return new Response(JSON.stringify({ data: [{ id: '~anthropic/claude-haiku-latest', alias_target: { slug: NEWEST } }] }), { status: 200 })
    }
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    sent.push({ url: String(input), body })
    call += 1
    return reply(idsAsked(body), call)
  }))
  return sent
}

const reply = (answers: Answer[], overrides: Record<string, unknown> = {}) => completion(JSON.stringify({ results: answers }), overrides)

interface Body {
  claims: Array<{ id: number; text: string; verdict: string; reason: string; uncovered?: string }>
  calls: Array<{ claims: number[]; status: string; detail: string; usage: { total_tokens: number; cost?: number } | null; model: string | null; modelCheck: string | null }>
  error?: string
  unreported?: number
}

async function check(text: string, sources = SOURCES): Promise<{ res: Response; body: Body }> {
  const res = await handler(request({ text, sources }))
  return { res, body: (await res.json()) as Body }
}

describe('the planted case through the check function', () => {
  it('marks the 0.8 million km sentence not confirmed and the true control confirmed', async () => {
    provider(ids => reply(ids.map(id => (id === 1
      ? answer(id, { all_parts_covered: 'no', spans: [{ source: 1, text: SPAN }], uncovered: 'operating position' })
      : answer(id)))))
    const { res, body } = await check(`${PLANTED} ${CONTROL}`)
    expect(res.status).toBe(200)
    expect(body.claims.map(claim => [claim.id, claim.verdict])).toEqual([[1, 'partly'], [2, 'supported']])
    expect(body.claims[0]?.uncovered).toBe('operating position')
  })

  it('does not confirm a sentence when the model quotes words that are not in the source', async () => {
    provider(ids => reply(ids.map(id => answer(id, { spans: [{ source: 1, text: 'settled into its operating position' }] }))))
    const { body } = await check(PLANTED)
    expect(body.claims[0]?.verdict).toBe('unverified')
  })

  it('never reads a verdict from the model', async () => {
    provider(ids => reply(ids.map(id => answer(id, { verdict: 'supported', source_supports: 'no' }))))
    const { body } = await check(CONTROL)
    expect(body.claims[0]?.verdict).toBe('unsupported')
  })

  it('sends only the cited source with an extract, the thinking-on alias and a token ceiling', async () => {
    const sent = provider(ids => reply(ids.map(id => answer(id))))
    await check(CONTROL)
    expect(sent).toHaveLength(1)
    const user = (sent[0]?.body.messages as Array<{ content: string }>)[1]?.content ?? ''
    expect(user).toContain(`[1] James Webb Space Telescope sunshield (Wikipedia): ${SUNSHIELD}`)
    expect(user).not.toContain('A headline only')
    expect(sent[0]?.body.model).toBe('~anthropic/claude-haiku-latest')
    expect(sent[0]?.body.max_tokens).toBe(4_500)
    expect(sent[0]?.body).not.toHaveProperty('reasoning')
  })
})

describe('a reply that cannot be used', () => {
  it('is never read when it ran out of length, and its usage is still counted', async () => {
    provider(ids => completion(JSON.stringify({ results: ids.map(id => answer(id)) }), { choices: [{ message: { content: JSON.stringify({ results: [answer(1)] }) }, finish_reason: 'length' }] }))
    const { body } = await check(CONTROL)
    expect(body.claims[0]?.verdict).toBe('unchecked')
    expect(body.calls[0]).toMatchObject({ status: 'failed', usage: { total_tokens: 1200, cost: 0.0002 } })
  })

  it('is never read when it names no finish reason', async () => {
    provider(ids => completion(JSON.stringify({ results: ids.map(id => answer(id)) }), { choices: [{ message: { content: JSON.stringify({ results: [answer(1)] }) } }] }))
    const { body } = await check(CONTROL)
    expect(body.claims[0]?.verdict).toBe('unchecked')
  })

  it('leaves a sentence not checked when the reply has no answer for it', async () => {
    provider(() => reply([answer(1)]))
    const { body } = await check(`${CONTROL} ${PLANTED}`)
    expect(body.claims.map(claim => claim.verdict)).toEqual(['supported', 'unchecked'])
  })
})

describe('batches', () => {
  const FIVE = Array.from({ length: 5 }, (_, i) => `Fact number ${i + 1} about the sunshield [1].`).join(' ')

  it('splits the sentences into calls of three, and sums the usage of all of them', async () => {
    const sent = provider(ids => reply(ids.map(id => answer(id))))
    const { body } = await check(FIVE)
    expect(sent.map(call => idsAsked(call.body))).toEqual([[1, 2, 3], [4, 5]])
    expect(body.calls.map(call => call.claims)).toEqual([[1, 2, 3], [4, 5]])
    expect(body.claims.every(claim => claim.verdict === 'supported')).toBe(true)
    expect(body.calls.reduce((total, call) => total + (call.usage?.total_tokens ?? 0), 0)).toBe(2400)
    expect(body.calls[0]).toMatchObject({ model: NEWEST, modelCheck: 'match' })
  })

  it('lets a failed batch fail alone: the others stand, and the failed one has an unknown bill', async () => {
    provider((ids, call) => (call === 1 ? new Response('upstream', { status: 503 }) : reply(ids.map(id => answer(id)))))
    const { res, body } = await check(FIVE)
    expect(res.status).toBe(200)
    expect(body.claims.map(claim => claim.verdict)).toEqual(['unchecked', 'unchecked', 'unchecked', 'supported', 'supported'])
    expect(body.calls[0]).toMatchObject({ status: 'failed', usage: null })
    expect(body.calls[1]).toMatchObject({ status: 'ok' })
  })

  it('counts a refused request (a 4xx) as a known zero', async () => {
    provider(() => new Response('no', { status: 402 }))
    const { body } = await check(CONTROL)
    expect(body.claims[0]?.verdict).toBe('unchecked')
    expect(body.calls[0]).toMatchObject({ status: 'failed', usage: { total_tokens: 0, cost: 0 } })
  })

  it('does not let a batch settle a sentence that belongs to another batch', async () => {
    provider((ids, call) => reply(call === 1 ? [answer(1), answer(2), answer(3), answer(4, { source_supports: 'yes' })] : [answer(5)].filter(() => ids.length === 0)))
    const { body } = await check(FIVE)
    expect(body.claims.map(claim => claim.verdict)).toEqual(['supported', 'supported', 'supported', 'unchecked', 'unchecked'])
  })

  it('lists the sentences past the limit as not checked, without a call for them', async () => {
    const many = Array.from({ length: 14 }, (_, i) => `Fact number ${i + 1} about the sunshield [1].`).join(' ')
    const sent = provider(ids => reply(ids.map(id => answer(id))))
    const { body } = await check(many)
    expect(sent).toHaveLength(4)
    expect(body.claims).toHaveLength(14)
    expect(body.claims.slice(12).map(claim => claim.verdict)).toEqual(['unchecked', 'unchecked'])
  })

  it('does not call the model for a sentence that cites a source it was not given', async () => {
    const sent = provider(ids => reply(ids.map(id => answer(id))))
    const { body } = await check('It is true [2].')
    expect(sent).toHaveLength(0)
    expect(body.claims[0]?.verdict).toBe('unsupported')
    expect(body.calls).toEqual([])
  })
})

describe('time', () => {
  it('ends a call that hangs at its own limit inside the 26 s request, and does not count it as free', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === LIST_URL) return new Response(JSON.stringify({ data: [] }), { status: 200 })
      return new Promise<Response>(() => undefined)
    }))
    const pending = handler(request({ text: CONTROL, sources: SOURCES }))
    await vi.advanceTimersByTimeAsync(22_100)
    const res = await pending
    expect(res.status).toBe(200)
    const body = (await res.json()) as Body
    expect(body.claims[0]?.verdict).toBe('unchecked')
    expect(body.calls[0]).toMatchObject({ status: 'failed', usage: null })
    expect(body.calls[0]?.detail).toContain('may still be billed')
  })
})

describe('the request', () => {
  it('refuses another origin, a missing key, an empty text and a body past the limit', async () => {
    provider(() => reply([]))
    expect((await handler(request({ text: CONTROL, sources: SOURCES }, { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await handler(request({ text: '', sources: SOURCES }))).status).toBe(400)
    expect((await handler(request({ text: 'x'.repeat(9_000), sources: SOURCES }))).status).toBe(413)
    expect((await handler(request(null, { rawBody: 'not json' }))).status).toBe(400)
    delete process.env.OPENROUTER_API_KEY
    expect((await handler(request({ text: CONTROL, sources: SOURCES }))).status).toBe(500)
  })

  it('accepts the page it was served from (a deploy preview)', async () => {
    provider(ids => reply(ids.map(id => answer(id))))
    const res = await handler(new Request('https://deploy-preview-3--x.netlify.app/api/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://deploy-preview-3--x.netlify.app', 'x-nf-client-connection-ip': '198.51.100.7' },
      body: JSON.stringify({ text: CONTROL, sources: SOURCES }),
    }))
    expect(res.status).toBe(200)
  })
})
