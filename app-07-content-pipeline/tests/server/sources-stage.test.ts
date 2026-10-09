import { describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/ai'
import { SITE_URL } from '../../netlify/shared/provider'
import {
  NOTES, completion, providerWill, request, stageBody, installFunctionHarness, words, type ErrorBody, type StageBody,
} from './harness'

installFunctionHarness()

describe('Sources stage', () => {
  const WIKI_BODY = {
    batchcomplete: true,
    query: {
      pages: [
        { pageid: 2, ns: 0, title: 'Software testing', index: 2, extract: 'Software testing is the act of checking whether software satisfies expectations, found by running it on real inputs.' },
        { pageid: 1, ns: 0, title: 'Unit testing', index: 1, extract: 'Unit testing is a software testing method in which individual units of source code are tested to see whether they work.' },
      ],
    },
  }
  const HN_BODY = {
    hits: [
      { title: 'Multiple assertions are fine in a unit test', url: 'https://stackoverflow.blog/2022/11/03/multiple-assertions-per-test-are-fine/', points: 319, created_at: '2022-11-05T10:00:00.000Z', objectID: '33478000' },
      { title: 'Cooking with fire', url: 'https://example.test/fire', points: 900, created_at: '2020-01-01T00:00:00.000Z', objectID: '1' },
    ],
  }

  // Answers the two lookups by host. Anything else fails the test.
  function lookupsWill(wikipedia: () => Response | Promise<Response>, hackerNews: () => Response | Promise<Response>): string[] {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      urls.push(url)
      if (url.startsWith('https://en.wikipedia.org/w/api.php?')) return wikipedia()
      if (url.startsWith('https://hn.algolia.com/api/v1/search?')) return hackerNews()
      throw new Error(`Unexpected request to ${url}`)
    }))
    return urls
  }

  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

  it('looks the topic up live, numbers the sources and answers with a Sources trace row and no model', async () => {
    const urls = lookupsWill(() => ok(WIKI_BODY), () => ok(HN_BODY))

    const res = await handler(request(stageBody('sources', {}, { topic: 'Why unit tests matter for small teams' })))
    expect(res.status).toBe(200)
    const body = (await res.json()) as StageBody
    expect(body.result).toBe([
      '[1] Wikipedia: Unit testing',
      'URL: https://en.wikipedia.org/wiki/Unit_testing',
      'Summary: Unit testing is a software testing method in which individual units of source code are tested to see whether they work.',
      '',
      '[2] Wikipedia: Software testing',
      'URL: https://en.wikipedia.org/wiki/Software_testing',
      'Summary: Software testing is the act of checking whether software satisfies expectations, found by running it on real inputs.',
      '',
      '[3] Hacker News: Multiple assertions are fine in a unit test',
      'URL: https://stackoverflow.blog/2022/11/03/multiple-assertions-per-test-are-fine/',
      'Points: 319',
      'Date: 2022-11-05',
    ].join('\n'))
    expect(body.trace).toHaveLength(1)
    expect(body.trace[0]).toMatchObject({ name: 'Sources', status: 'ok', detail: '3 sources: 2 Wikipedia, 1 Hacker News.' })
    expect(body.trace[0]).not.toHaveProperty('tokens')
    expect(body.usage).toBeNull()
    expect(body.model).toBeNull()
    expect(urls).toHaveLength(2)
    expect(urls.some(url => url.includes('openrouter'))).toBe(false)
  })

  it('does not search Hacker News for marketing copy and says so', async () => {
    const urls = lookupsWill(() => ok(WIKI_BODY), () => ok(HN_BODY))
    const res = await handler(request(stageBody('sources', {}, { contentType: 'Marketing Copy' })))
    const body = (await res.json()) as StageBody
    expect(urls).toHaveLength(1)
    expect(body.trace[0]).toMatchObject({ detail: '2 sources: 2 Wikipedia, 0 Hacker News. Hacker News is not searched for marketing copy.' })
    expect(body.result).toContain('Note: Hacker News is not searched for marketing copy.')
  })

  it('keeps the Wikipedia sources and names the lookup that failed', async () => {
    lookupsWill(() => ok(WIKI_BODY), () => new Response('down', { status: 503 }))
    const body = (await (await handler(request(stageBody('sources')))).json()) as StageBody
    expect(body.trace[0]).toMatchObject({ status: 'ok', detail: '2 sources: 2 Wikipedia, 0 Hacker News. Hacker News was unavailable.' })
  })

  it('says a lookup did not answer in time when it hits the time cap', async () => {
    lookupsWill(() => ok(WIKI_BODY), () => { throw new DOMException('The operation timed out.', 'TimeoutError') })
    const body = (await (await handler(request(stageBody('sources')))).json()) as StageBody
    expect(String(body.trace[0].detail)).toContain('Hacker News did not answer in time.')
  })

  it('applies one 4 second cap to both lookups', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // Both lookups hang until the signal fires, as a stalled upstream would.
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      if (init?.signal) signals.push(init.signal)
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })))

    const pending = handler(request(stageBody('sources')))
    await vi.advanceTimersByTimeAsync(3_999)
    expect(signals).toHaveLength(2)
    expect(signals.every(signal => !signal.aborted)).toBe(true)
    await vi.advanceTimersByTimeAsync(1)

    const body = (await (await pending).json()) as StageBody
    expect(body.trace[0]).toMatchObject({
      status: 'ok',
      detail: 'No sources found. Wikipedia did not answer in time. Hacker News did not answer in time.',
    })
  })

  it('ends a lookup whose body never finishes at the 4 second cap, and keeps the other source', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const stalled = () => new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 })
    lookupsWill(() => ok(WIKI_BODY), stalled)

    const pending = handler(request(stageBody('sources')))
    await vi.advanceTimersByTimeAsync(4_000)
    const body = (await (await pending).json()) as StageBody
    expect(body.trace[0]).toMatchObject({
      status: 'ok',
      detail: '2 sources: 2 Wikipedia, 0 Hacker News. Hacker News did not answer in time.',
    })
  })

  it('continues without sources when nothing is found, and the pack says so', async () => {
    lookupsWill(() => ok({ batchcomplete: true }), () => ok({ hits: [] }))
    const body = (await (await handler(request(stageBody('sources')))).json()) as StageBody
    expect(body.result).toBe([
      'No live sources were found for this topic.',
      'Note: Wikipedia returned no matching results.\nNote: Hacker News returned no matching results.',
    ].join('\n\n'))
    expect(body.trace[0]).toMatchObject({
      status: 'ok',
      detail: 'No sources found. Wikipedia returned no matching results. Hacker News returned no matching results.',
    })
  })

  it('refuses redirects and sends a descriptive User-Agent to both hosts', async () => {
    const inits: RequestInit[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      inits.push(init ?? {})
      return ok({})
    }))
    await handler(request(stageBody('sources')))
    expect(inits).toHaveLength(2)
    for (const init of inits) {
      expect(init.redirect).toBe('error')
      expect(String((init.headers as Record<string, string>)['User-Agent'])).toMatch(/^ContentForge\/1\.0 /)
    }
  })

  it('answers 503 when the browser stopped the run', async () => {
    const controller = new AbortController()
    lookupsWill(() => { controller.abort(); return ok(WIKI_BODY) }, () => ok(HN_BODY))
    const req = new Request('https://example.test/api/ai', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', origin: SITE_URL, 'x-nf-client-connection-ip': '203.0.113.200' },
      body: JSON.stringify(stageBody('sources')),
    })
    const res = await handler(req)
    expect(res.status).toBe(503)
    expect(((await res.json()) as ErrorBody).error).toBe('The run was stopped before this stage finished.')
  })
})

describe('Polish ends with the Sources list', () => {
  const EDIT = words(100)
  const PIECE = `${words(70)} claim one [1]. Another claim [3]. Invented claim [9]. Code looks like items[0].`

  it('appends the list built from the lookup, keeps real citations and drops invented ones', async () => {
    providerWill(() => completion(PIECE))
    const res = await handler(request(stageBody('polish', { edit: EDIT })))
    const { result } = (await res.json()) as StageBody
    expect(result).toBe([
      `${words(70)} claim one [1]. Another claim [3]. Invented claim. Code looks like items[0].`,
      '',
      '### Sources',
      '',
      '- [1] [Unit testing](https://en.wikipedia.org/wiki/Unit_testing), Wikipedia',
      '- [3] [Multiple assertions are fine in a unit test](https://stackoverflow.blog/2022/11/03/multiple-assertions-per-test-are-fine/), Hacker News, 319 points, 2022-11-05',
    ].join('\n'))
  })

  it('uses short links for a social thread', async () => {
    providerWill(() => completion(`${words(70)} point [2].`))
    const res = await handler(request(stageBody('polish', { edit: EDIT }, { contentType: 'Social Thread' })))
    const { result } = (await res.json()) as StageBody
    expect(result.endsWith('**Sources**\n\n- [2] [en.wikipedia.org/wiki/Test-driven\\_development](https://en.wikipedia.org/wiki/Test-driven_development)')).toBe(true)
  })

  it('says the piece has no sources when the lookup found none', async () => {
    providerWill(() => completion(`${words(70)} text [1].`))
    const none = 'No live sources were found for this topic.\n\nNote: Wikipedia returned no matching results.'
    const res = await handler(request(stageBody('polish', { edit: EDIT, sources: none })))
    const { result } = (await res.json()) as StageBody
    expect(result).toBe(`${words(70)} text.\n\n*No sources: the live lookups found nothing for this topic, so the facts above come from the model and are unchecked.*`)
  })

  it('sends the model the citation rules only when sources exist', async () => {
    const sent = providerWill(() => completion(words(80)))
    await handler(request(stageBody('draft', { research: NOTES, outline: '- P', sources: 'No live sources were found for this topic.' })))
    const system = (sent[0].body.messages as Array<{ content: string }>)[0].content
    expect(system).toContain('No live sources were found, so avoid specific statistics')
    expect(system).not.toContain('square brackets')
  })
})

