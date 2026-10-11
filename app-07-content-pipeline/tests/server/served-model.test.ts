import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ARTICLE, completion, installFunctionHarness, request, stageBody } from './harness'

const ALIAS = '~anthropic/claude-haiku-latest'
const NEWEST = 'anthropic/claude-haiku-5.5'
const OTHER = 'anthropic/claude-haiku-5.4'
const LIST_URL = 'https://openrouter.ai/api/v1/models'
const PREVIEW = 'https://deploy-preview-9--jdgafx-app-07-content-pipeline.netlify.app'
const HOUR_MS = 60 * 60 * 1000

type Handler = (req: Request) => Promise<Response>
let handler: Handler

installFunctionHarness()

// The newest model is kept per function instance, so each test loads a fresh copy of the function.
beforeEach(async () => {
  vi.resetModules()
  handler = (await import('../../netlify/functions/ai')).default
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

// The list as OpenRouter sends it, with the alias entry naming `slug`, or no target when `slug` is null.
function listNaming(slug: string | null): Response {
  return json({
    data: [
      { id: 'openai/gpt-4o', alias_target: null },
      { id: ALIAS, alias_target: slug === null ? null : { slug } },
    ],
  })
}

// Answers the model list with `list` and each provider call with `reply`. Both are counted.
function stubProvider(list: () => Response, reply: () => Response) {
  const counts = { listed: 0, provider: 0 }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === LIST_URL) {
      counts.listed += 1
      return list()
    }
    counts.provider += 1
    return reply()
  }))
  return counts
}

describe('the served model on a stage reply', () => {
  it('never puts the requested alias in place of a served model the reply does not name', async () => {
    stubProvider(() => listNaming(NEWEST), () => completion(ARTICLE, { model: undefined }))

    const res = await handler(request(stageBody('research')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.model).toBeNull()
    expect(body.model).not.toBe(ALIAS)
    expect(body.modelCheck).toBe('not-reported')
  })

  it('reports no served model on a refused reply that names none either', async () => {
    stubProvider(() => listNaming(NEWEST), () => completion('', { model: undefined }))

    const res = await handler(request(stageBody('research')))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ model: null, modelCheck: 'not-reported' })
  })

  it('sends no check for a failure that got no reply, so it does not count against the run', async () => {
    stubProvider(() => listNaming(NEWEST), () => new Response('provider down', { status: 500 }))

    const res = await handler(request(stageBody('research')))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ model: null, newestModel: null, modelCheck: null })
  })

  it('marks a reply from the newest model as a match and names that model', async () => {
    stubProvider(() => listNaming(NEWEST), () => completion(ARTICLE))

    const res = await handler(request(stageBody('research')))
    expect(await res.json()).toMatchObject({ model: NEWEST, newestModel: NEWEST, modelCheck: 'match' })
  })

  it('shows a reply from another model as a mismatch, and logs the difference without refusing the reply', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    stubProvider(() => listNaming(NEWEST), () => completion(ARTICLE, { model: OTHER }))

    const res = await handler(request(stageBody('research')))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ model: OTHER, newestModel: NEWEST, modelCheck: 'mismatch' })
    expect(warn).toHaveBeenCalledWith(`model mismatch: served ${OTHER}, newest ${NEWEST}, requested ${ALIAS}`)
  })

  it('marks a reply unchecked when the list cannot be had', async () => {
    stubProvider(() => json({ error: 'down' }, 503), () => completion(ARTICLE))

    const res = await handler(request(stageBody('research')))
    expect(await res.json()).toMatchObject({ model: NEWEST, newestModel: null, modelCheck: 'unchecked' })
  })

  it('marks a reply unchecked when the list has no target for the alias, and asks the list again on the next run', async () => {
    const counts = stubProvider(() => listNaming(null), () => completion(ARTICLE))

    await handler(request(stageBody('research')))
    const res = await handler(request(stageBody('research')))
    expect(await res.json()).toMatchObject({ modelCheck: 'unchecked' })
    expect(counts.listed).toBe(2)
  })

  it('keeps a resolved newest model for an hour, so later runs do not ask the list again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-11T12:00:00Z'))
    const counts = stubProvider(() => listNaming(NEWEST), () => completion(ARTICLE))

    await handler(request(stageBody('research')))
    await handler(request(stageBody('research')))
    expect(counts.listed).toBe(1)

    vi.setSystemTime(new Date(Date.parse('2026-10-11T12:00:00Z') + HOUR_MS + 1))
    await handler(request(stageBody('research')))
    expect(counts.listed).toBe(2)
    vi.useRealTimers()
  })
})

describe('same-origin requests', () => {
  function previewRequest(origin: string | null): Request {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-nf-client-connection-ip': '203.0.113.250' }
    if (origin !== null) headers.origin = origin
    return new Request(`${PREVIEW}/api/ai`, { method: 'POST', headers, body: JSON.stringify(stageBody('research')) })
  }

  it('accepts a deploy preview calling its own function, whose host the live site does not name', async () => {
    stubProvider(() => listNaming(NEWEST), () => completion(ARTICLE))
    const res = await handler(previewRequest(PREVIEW))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(PREVIEW)
  })

  it('refuses a foreign origin calling a deploy preview', async () => {
    const counts = stubProvider(() => listNaming(NEWEST), () => completion(ARTICLE))
    const res = await handler(previewRequest('https://evil.example'))
    expect(res.status).toBe(403)
    expect(counts.provider).toBe(0)
  })

  it('still accepts a request with no Origin header, as before', async () => {
    stubProvider(() => listNaming(NEWEST), () => completion(ARTICLE))
    expect((await handler(previewRequest(null))).status).toBe(200)
  })
})
