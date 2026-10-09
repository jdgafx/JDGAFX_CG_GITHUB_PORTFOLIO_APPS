import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/ai'

const ORIGIN = 'https://jdgafx-app-10-browser-agent.netlify.app'
const PLACEHOLDER = 'test-only-placeholder'
const SERVED = 'anthropic/claude-haiku-5.5'
const USAGE = { prompt_tokens: 812, completion_tokens: 164, total_tokens: 976, cost: 0.00042 }
const PLAN = {
  steps: [
    { action: 'navigate', target: 'Google home page', thought: 'Open the Google home page.', url: 'https://www.google.com/' },
    { action: 'extract', target: 'page title', thought: 'Read the title the browser sees.', value: 'The page title' },
  ],
}
const ALLOWED_LIST = 'google.com, www.google.com, flights.google.com, en.wikipedia.org, news.ycombinator.com'

interface TraceEntry {
  name: string
  status: string
  ms: number
  detail: string
}

interface PlanBody {
  result?: { steps: unknown[] }
  trace?: TraceEntry[]
  usage?: typeof USAGE
  model?: string
  error?: string
  totalMs?: number
}

const fetchMock = vi.fn<typeof fetch>()
const originalKey = process.env.OPENROUTER_API_KEY
let nextClient = 1

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  // The handler logs failures on purpose. The logs are silenced here and checked where it matters.
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  process.env.OPENROUTER_API_KEY = PLACEHOLDER
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = originalKey
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

interface RequestOptions {
  method?: string
  origin?: string | null
  ip?: string
  raw?: string
}

function planRequest(body: unknown, options: RequestOptions = {}): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-nf-client-connection-ip': options.ip ?? `198.51.100.${nextClient++}`,
  }
  const origin = options.origin === undefined ? ORIGIN : options.origin
  if (origin !== null) headers.origin = origin
  const method = options.method ?? 'POST'
  return new Request('https://site.example/api/ai', {
    method,
    headers,
    body: method === 'GET' || method === 'OPTIONS' ? undefined : (options.raw ?? JSON.stringify(body)),
  })
}

/** A provider answer in the chat-completions shape, with a fresh body on every call. */
function reply(content: string, finish: string | null = 'stop'): Response {
  return new Response(JSON.stringify({
    model: SERVED,
    choices: [{ message: { content }, finish_reason: finish }],
    usage: USAGE,
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function bodyOf(response: Response): Promise<PlanBody> {
  return await response.json() as PlanBody
}

describe('planner function: a plan', () => {
  it('returns the parsed steps, the served model, the usage and a measured trace', async () => {
    fetchMock.mockResolvedValueOnce(reply(JSON.stringify(PLAN)))
    const response = await handler(planRequest({ task: 'Open google.com and report the page title.' }))
    const body = await bodyOf(response)

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(body.result?.steps).toEqual(PLAN.steps)
    expect(body.model).toBe(SERVED)
    expect(body.usage).toEqual(USAGE)
    expect(body.trace?.map((entry) => entry.name)).toEqual(['Request built', 'Model call', 'Parse and validate'])
    expect(body.trace?.[0]?.detail).toContain(`Allowed sites: ${ALLOWED_LIST}.`)
    expect(body.trace?.[1]).toMatchObject({ status: 'ok' })
    expect(body.trace?.[1]?.detail).toContain(`Served by ${SERVED}. Finish reason: stop.`)
    expect(body.trace?.[2]).toMatchObject({ status: 'ok', detail: '2 steps. Every address is on an allowed site.' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a total equal to the sum of its trace rows, even when the clock ticks between rows', async () => {
    // Every clock read moves time on, so any span measured outside a row would show up in a wall-clock total.
    let now = 1_700_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 7))
    fetchMock.mockResolvedValueOnce(reply(JSON.stringify(PLAN)))
    const body = await bodyOf(await handler(planRequest({ task: 'Open google.com and report the page title.' })))

    const rows = body.trace?.map((entry) => entry.ms) ?? []
    expect(rows).toHaveLength(3)
    expect(rows.every((ms) => ms > 0)).toBe(true)
    expect(body.totalMs).toBe(rows.reduce((total, ms) => total + ms, 0))
  })

  it('keeps the total equal to the rows on a failed plan too', async () => {
    fetchMock.mockImplementation(async () => reply('{"steps":[{"action":"navigate"', 'length'))
    const body = await bodyOf(await handler(planRequest({ task: 'Open google.com' })))
    const rows = body.trace?.map((entry) => entry.ms) ?? []
    expect(rows).toHaveLength(2)
    expect(body.totalMs).toBe(rows.reduce((total, ms) => total + ms, 0))
  })

  it('sends the fixed model, the token cap, usage reporting and the allowlist to the provider', async () => {
    fetchMock.mockResolvedValueOnce(reply(JSON.stringify(PLAN)))
    await handler(planRequest({ task: 'Open google.com and report the page title.' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${PLACEHOLDER}`)
    const sent = JSON.parse(String(init?.body)) as {
      model: string
      max_tokens: number
      usage: unknown
      stream: boolean
      messages: Array<{ role: string; content: string }>
    }
    expect(sent.model).toBe('anthropic/claude-haiku-5.5')
    expect(sent).not.toHaveProperty('temperature')
    expect(sent.max_tokens).toBe(4096)
    expect(sent.usage).toEqual({ include: true })
    expect(sent.stream).toBe(false)
    expect(sent.messages[0].content).toContain(`Use only these hosts in url: ${ALLOWED_LIST}.`)
    expect(sent.messages[1]).toEqual({ role: 'user', content: 'Task: Open google.com and report the page title.' })
  })

  it('reads a plan wrapped in a markdown fence, or in prose', async () => {
    fetchMock.mockResolvedValueOnce(reply(`\`\`\`json\n${JSON.stringify(PLAN)}\n\`\`\``))
    fetchMock.mockResolvedValueOnce(reply(`Here is the plan: ${JSON.stringify(PLAN)} Good luck.`))
    const fenced = await bodyOf(await handler(planRequest({ task: 'Open google.com' })))
    const prose = await bodyOf(await handler(planRequest({ task: 'Open google.com' })))
    expect(fenced.result?.steps).toEqual(PLAN.steps)
    expect(prose.result?.steps).toEqual(PLAN.steps)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('asks the model once more when the first answer is empty, and says so in the trace', async () => {
    fetchMock.mockResolvedValueOnce(reply('', 'stop'))
    fetchMock.mockResolvedValueOnce(reply(JSON.stringify(PLAN)))
    const response = await handler(planRequest({ task: 'Open google.com' }))
    const body = await bodyOf(response)

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(body.result?.steps).toEqual(PLAN.steps)
    expect(body.trace?.[1]?.detail).toContain('The first answer was empty or cut off, so the model was asked again.')
    expect(body.usage).toEqual({ prompt_tokens: 1624, completion_tokens: 328, total_tokens: 1952, cost: 0.00084 })
  })

  it('stops after two cut-off answers with a plain message and both attempts in the trace', async () => {
    fetchMock.mockImplementation(async () => reply('{"steps":[{"action":"navigate"', 'length'))
    const response = await handler(planRequest({ task: 'Open google.com' }))
    const body = await bodyOf(response)

    expect(response.status).toBe(502)
    expect(body.error).toBe('The model ran out of room before finishing the plan. Try a shorter task.')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(body.trace?.[1]).toMatchObject({ status: 'failed', detail: 'Asked twice. The answer was cut off.' })
  })

  it('refuses a plan that opens a site outside the allowlist, and marks the parse step failed', async () => {
    fetchMock.mockResolvedValueOnce(reply(JSON.stringify({
      steps: [
        { action: 'navigate', target: 'Example', thought: 'Open it.', url: 'https://example.com/' },
        { action: 'extract', target: 'page title', thought: 'Read it.', value: 'The title' },
      ],
    })))
    const response = await handler(planRequest({ task: 'Report the page title of a demo site' }))
    const body = await bodyOf(response)

    expect(response.status).toBe(502)
    expect(body.error).toBe(`Step 1 opens example.com, which is outside the allowed sites: ${ALLOWED_LIST}.`)
    expect(body.trace?.at(-1)).toMatchObject({ name: 'Parse and validate', status: 'failed' })
  })
})

describe('planner function: refusals before any provider call', () => {
  it('answers a missing or blank task with the handler message', async () => {
    for (const body of [{}, { task: '   ' }, { task: 42 }]) {
      const response = await handler(planRequest(body))
      expect(response.status).toBe(400)
      expect((await bodyOf(response)).error).toBe('Enter a task first.')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers a task over 500 characters, and accepts exactly 500', async () => {
    const tooLong = await handler(planRequest({ task: 'x'.repeat(501) }))
    expect(tooLong.status).toBe(400)
    expect((await bodyOf(tooLong)).error).toBe('Keep the task under 500 characters.')

    fetchMock.mockResolvedValueOnce(reply(JSON.stringify(PLAN)))
    const limit = await handler(planRequest({ task: 'x'.repeat(500) }))
    expect(limit.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('answers a body that is not JSON, or is too large, in plain words', async () => {
    const notJson = await handler(planRequest(undefined, { raw: '{"task":' }))
    expect(notJson.status).toBe(400)
    expect((await bodyOf(notJson)).error).toBe('The request body is not valid JSON.')

    const huge = await handler(planRequest({ task: 'x'.repeat(9_000) }))
    expect(huge.status).toBe(400)
    expect((await bodyOf(huge)).error).toBe('The request is too large.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 405 with a JSON message to a GET', async () => {
    const response = await handler(planRequest(undefined, { method: 'GET' }))
    expect(response.status).toBe(405)
    expect((await bodyOf(response)).error).toBe('Use POST for this request.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers the preflight only for an allowed origin', async () => {
    const allowed = await handler(planRequest(undefined, { method: 'OPTIONS' }))
    expect(allowed.status).toBe(204)
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)

    const other = await handler(planRequest(undefined, { method: 'OPTIONS', origin: 'https://evil.example' }))
    expect(other.status).toBe(403)
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('refuses an origin that is not on the allowlist before reading the body', async () => {
    const response = await handler(planRequest({ task: 'Open google.com' }, { origin: 'https://evil.example' }))
    expect(response.status).toBe(403)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect((await bodyOf(response)).error).toBe('This page is not allowed to plan tasks.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('trims the key it sends, and teaches the planner the selector field and the known selectors', async () => {
    process.env.OPENROUTER_API_KEY = ` ${PLACEHOLDER} `
    fetchMock.mockResolvedValueOnce(reply(JSON.stringify(PLAN)))
    await handler(planRequest({ task: 'Open news.ycombinator.com and report the top three story titles' }))
    const [, init] = fetchMock.mock.calls[0]
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${PLACEHOLDER}`)
    const prompt = (JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }).messages[0].content
    expect(prompt).toContain('- selector?: a plain CSS selector')
    expect(prompt).toContain('".titleline > a"')
    expect(prompt).toContain('"table.infobox"')
  })

  it('keeps the selector of an extract step the planner returned', async () => {
    const plan = { steps: [
      { action: 'navigate', target: 'Hacker News', thought: 'Open it.', url: 'https://news.ycombinator.com/' },
      { action: 'extract', target: 'story titles', thought: 'Read them.', value: 'Top titles', selector: '.titleline > a' },
    ] }
    fetchMock.mockResolvedValueOnce(reply(JSON.stringify(plan)))
    const body = await bodyOf(await handler(planRequest({ task: 'Open news.ycombinator.com and report the top three story titles' })))
    expect(body.result?.steps[1]).toEqual(plan.steps[1])
  })

  it('refuses a task that names a site outside the allowlist before any model call', async () => {
    const response = await handler(planRequest({ task: 'Open example.com and report the page title' }))
    const body = await bodyOf(response)
    expect(response.status).toBe(400)
    expect(body.error).toBe(`This task names example.com, which is outside the allowed sites: ${ALLOWED_LIST}.`)
    expect(body.trace?.map((entry) => [entry.name, entry.status])).toEqual([['Request built', 'ok'], ['Check task sites', 'failed']])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lets a task through that names only allowed sites', async () => {
    fetchMock.mockResolvedValueOnce(reply(JSON.stringify(PLAN)))
    const response = await handler(planRequest({ task: 'Open en.wikipedia.org/wiki/Hubble_Space_Telescope and report its launch date' }))
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('turns a planner refusal into a plain 400 with no steps', async () => {
    fetchMock.mockResolvedValueOnce(reply(JSON.stringify({ refuse: 'The weather needs a   site outside the list.' })))
    const response = await handler(planRequest({ task: 'Report the weather in Paris' }))
    const body = await bodyOf(response)
    expect(response.status).toBe(400)
    expect(body.error).toBe('The planner declined this task: The weather needs a site outside the list.')
    expect(body.result).toBeUndefined()
    expect(body.trace?.at(-1)).toMatchObject({ name: 'Parse and validate', status: 'failed' })
  })

  it('rejects a plan whose label names one site while its url opens another', async () => {
    const swapped = { steps: [
      { action: 'navigate', target: 'example.com home page', thought: 'Open it.', url: 'https://www.google.com/' },
      { action: 'extract', target: 'page title', thought: 'Read it.' },
    ] }
    fetchMock.mockResolvedValueOnce(reply(JSON.stringify(swapped)))
    const response = await handler(planRequest({ task: 'Report the page title of a home page' }))
    expect(response.status).toBe(502)
    expect((await bodyOf(response)).error).toBe('Step 1 is labelled example.com but opens www.google.com.')
  })

  it('tells the planner to refuse rather than substitute a site, and where the featured article blurb is', async () => {
    fetchMock.mockResolvedValueOnce(reply(JSON.stringify(PLAN)))
    await handler(planRequest({ task: 'Open google.com and report the page title' }))
    const prompt = (JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { messages: Array<{ content: string }> }).messages[0].content
    expect(prompt).toContain('Return {"refuse": "<one plain sentence saying why>"}')
    expect(prompt).not.toContain('closest step')
    expect(prompt).toContain('"#mp-tfa > p"')
  })

  it('answers 503 when the provider key is blank', async () => {
    process.env.OPENROUTER_API_KEY = ''
    const response = await handler(planRequest({ task: 'Open google.com' }))
    expect(response.status).toBe(503)
    expect((await bodyOf(response)).error).toBe('The agent service is not configured yet. Please try again later.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('limits planning to 20 calls a minute from one client, then answers 429', async () => {
    const ip = '203.0.113.77'
    for (let call = 0; call < 20; call++) {
      expect((await handler(planRequest({}, { ip }))).status).toBe(400)
    }
    const limited = await handler(planRequest({}, { ip }))
    expect(limited.status).toBe(429)
    expect((await bodyOf(limited)).error).toBe('Too many planning requests from this connection. Wait a minute and try again.')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('planner function: provider failures', () => {
  it('maps a provider 402 to plain copy and never echoes the provider body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"PROVIDER-DETAIL-MARKER"}', { status: 402 }))
    const response = await handler(planRequest({ task: 'Open google.com' }))
    const text = await response.text()
    expect(response.status).toBe(502)
    expect(JSON.parse(text)).toMatchObject({ error: 'The AI provider rejected the key or is out of credit' })
    expect(text).not.toContain('PROVIDER-DETAIL-MARKER')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps a provider 500 and a provider 429 to their plain copy, with no retry', async () => {
    fetchMock.mockResolvedValueOnce(new Response('upstream PROVIDER-DETAIL-MARKER', { status: 500 }))
    const failed = await handler(planRequest({ task: 'Open google.com' }))
    expect(failed.status).toBe(502)
    expect((await bodyOf(failed)).error).toBe('The AI provider did not answer in time')

    fetchMock.mockResolvedValueOnce(new Response('slow down', { status: 429 }))
    const limited = await handler(planRequest({ task: 'Open google.com' }))
    expect((await bodyOf(limited)).error).toBe('Rate limited, try again in a minute')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('maps a provider timeout (an AbortError) to the timeout copy with a 504', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'AbortError' }))
    const response = await handler(planRequest({ task: 'Open google.com' }))
    expect(response.status).toBe(504)
    expect((await bodyOf(response)).error).toBe('The AI provider did not answer in time')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats a timeout while reading the answer the same way', async () => {
    const stalled = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))
      },
    })
    fetchMock.mockResolvedValueOnce(new Response(stalled, { status: 200 }))
    const response = await handler(planRequest({ task: 'Open google.com' }))
    expect(response.status).toBe(504)
    expect((await bodyOf(response)).error).toBe('The AI provider did not answer in time')
  })

  it('ends a reply whose body never finishes at the planning budget, with the timeout copy', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const stalled = new ReadableStream<Uint8Array>({ start() {} })
    fetchMock.mockResolvedValueOnce(new Response(stalled, { status: 200, headers: { 'content-type': 'application/json' } }))
    const pending = handler(planRequest({ task: 'Open google.com' }))
    await vi.advanceTimersByTimeAsync(8_500)
    const response = await pending
    expect(response.status).toBe(504)
    expect((await bodyOf(response)).error).toBe('The AI provider did not answer in time')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps a dropped provider connection to a plain sentence', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const response = await handler(planRequest({ task: 'Open google.com' }))
    expect(response.status).toBe(502)
    expect((await bodyOf(response)).error).toBe('The AI provider could not be reached. Try again in a moment.')
  })

  it('reports an answer that is not JSON as unreadable', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>gateway</html>', { status: 200 }))
    const response = await handler(planRequest({ task: 'Open google.com' }))
    expect(response.status).toBe(502)
    expect((await bodyOf(response)).error).toBe('The AI provider returned an unreadable answer. Try again.')
  })

  it('answers 500 with a generic message when something unexpected fails', async () => {
    const broken = {
      headers: new Headers({ origin: ORIGIN }),
      get method(): string {
        throw new Error('broken request')
      },
    } as unknown as Request
    const response = await handler(broken)
    expect(response.status).toBe(500)
    expect((await bodyOf(response)).error).toBe('Something went wrong while planning this task. Please try again.')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(console.error).toHaveBeenCalledWith('Planner handler failed:', 'Error')
  })
})
