import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { modelListReply, routeFetch } from '../fixtures/openRouterList'

// Each test loads a fresh copy of the function, so the newest-model cache starts empty.

type FetchFn = (url: string, init: RequestInit) => Promise<Response>

interface Reply {
  error?: string
  result?: Record<string, unknown>
  model?: string | null
  newestModel?: string | null
  modelCheck?: string
}

const KEY = 'test-only-placeholder'
const SERVED = 'anthropic/claude-haiku-5.5'
const NEWER = 'anthropic/claude-haiku-5.6'
const OLDER = 'anthropic/claude-haiku-5.4'
const ALIAS = '~anthropic/claude-haiku-latest'
const PLAN = {
  chartType: 'bar',
  groupBy: 'product',
  aggregate: { field: 'revenue', fn: 'sum' },
  title: 'Total revenue by product',
  explanation: 'Adds up revenue for each product.',
}
const WRONG = JSON.stringify({ ...PLAN, groupBy: 'category' })
const BODY = {
  question: 'Which product has the highest total revenue?',
  headers: ['date', 'product', 'revenue', 'units', 'region'],
  sampleRows: [{ date: '2024-01-08', product: 'Widget A', revenue: '15200', units: '304', region: 'North' }],
  rowCount: 50,
}

let savedKey: string | undefined
let clientCounter = 0

beforeEach(() => {
  savedKey = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = KEY
})

afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = savedKey
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function loadHandler() {
  vi.resetModules()
  return (await import('../../netlify/functions/ai')).default
}

/** A chat reply. Without `served` it names no model, as a reply cut short by a provider can. */
function chatReply(content: string, served: string | null = SERVED): Response {
  const body = { choices: [{ message: { content }, finish_reason: 'stop' }], usage: {} }
  return new Response(JSON.stringify(served === null ? body : { model: served, ...body }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Stubs the provider with `chat` for each call, and the model list with `list` for each call. */
function stub(list: () => Response, chat: () => Response = () => chatReply(JSON.stringify(PLAN))) {
  const provider = vi.fn<FetchFn>(async () => chat())
  const listMock = vi.fn<FetchFn>(async () => list())
  vi.stubGlobal('fetch', routeFetch(provider, listMock))
  return { provider, listMock }
}

function request() {
  clientCounter += 1
  return new Request('https://app.example/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173', 'x-forwarded-for': `model-check-${clientCounter}` },
    body: JSON.stringify(BODY),
  })
}

async function readReply(response: Response): Promise<Reply> {
  return (await response.json()) as Reply
}

describe('ai function served model against the newest model', () => {
  it('returns a served model that is not the newest, logs the mismatch, and still shows the plan', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const handler = await loadHandler()
    stub(() => modelListReply(NEWER))
    const response = await handler(request())
    expect(response.status).toBe(200)
    const reply = await readReply(response)
    expect(reply.result).toMatchObject({ groupBy: 'product' })
    expect(reply).toMatchObject({ model: SERVED, newestModel: NEWER, modelCheck: 'mismatch' })
    expect(warn).toHaveBeenCalledWith(`model mismatch: served ${SERVED}, newest ${NEWER}, requested ${ALIAS}`)
  })

  it('does not warn when the served model is the newest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const handler = await loadHandler()
    stub(() => modelListReply(SERVED))
    const reply = await readReply(await handler(request()))
    expect(reply).toMatchObject({ model: SERVED, newestModel: SERVED, modelCheck: 'match' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('reports unchecked when the list has no entry for the alias, and asks the list again on the next run', async () => {
    const handler = await loadHandler()
    let answer = (): Response => modelListReply(null)
    const { listMock } = stub(() => answer())

    const first = await readReply(await handler(request()))
    expect(first).toMatchObject({ model: SERVED, newestModel: null, modelCheck: 'unchecked' })

    answer = () => modelListReply(SERVED)
    const second = await readReply(await handler(request()))
    expect(second).toMatchObject({ newestModel: SERVED, modelCheck: 'match' })
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('keeps a resolved newest model, so a second run does not ask the list again', async () => {
    const handler = await loadHandler()
    const { listMock } = stub(() => modelListReply(SERVED))
    await handler(request())
    const second = await readReply(await handler(request()))
    expect(second).toMatchObject({ newestModel: SERVED, modelCheck: 'match' })
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('shows not reported when the reply names no model', async () => {
    const handler = await loadHandler()
    const { provider } = stub(() => modelListReply(SERVED), () => chatReply(JSON.stringify(PLAN), null))
    const response = await handler(request())
    expect(response.status).toBe(200)
    expect(await readReply(response)).toMatchObject({ model: null, modelCheck: 'not-reported' })
    expect(provider).toHaveBeenCalledTimes(1)
  })

  it('shows not reported when the repair turn names no model, rather than the first reply model', async () => {
    const handler = await loadHandler()
    let calls = 0
    stub(
      () => modelListReply(SERVED),
      () => {
        calls += 1
        return calls === 1 ? chatReply(WRONG) : chatReply(JSON.stringify(PLAN), null)
      },
    )
    const reply = await readReply(await handler(request()))
    expect(reply.result).toMatchObject({ groupBy: 'product' })
    expect(reply).toMatchObject({ model: null, modelCheck: 'not-reported' })
  })

  it('shows a mismatch from the repair turn when the first try matched, and warns once for it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const handler = await loadHandler()
    const replies = [chatReply(WRONG, SERVED), chatReply(JSON.stringify(PLAN), OLDER)]
    let call = 0
    stub(() => modelListReply(SERVED), () => replies[call++] as Response)
    const reply = await readReply(await handler(request()))
    expect(reply.result).toMatchObject({ groupBy: 'product' })
    expect(reply).toMatchObject({ model: OLDER, newestModel: SERVED, modelCheck: 'mismatch', checkedModel: OLDER })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(`model mismatch: served ${OLDER}, newest ${SERVED}, requested ${ALIAS}`)
  })

  it('checks the first try of an empty reply that is retried, so its mismatch still shows', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const handler = await loadHandler()
    const replies = [chatReply('', OLDER), chatReply(JSON.stringify(PLAN), SERVED)]
    let call = 0
    stub(() => modelListReply(SERVED), () => replies[call++] as Response)
    const reply = await readReply(await handler(request()))
    expect(reply).toMatchObject({ model: SERVED, newestModel: SERVED, modelCheck: 'mismatch', checkedModel: OLDER })
    expect(warn).toHaveBeenCalledWith(`model mismatch: served ${OLDER}, newest ${SERVED}, requested ${ALIAS}`)
  })

  it('keeps a mismatch from the first try when the repair turn matched, and names that first try', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const handler = await loadHandler()
    const replies = [chatReply(WRONG, OLDER), chatReply(JSON.stringify(PLAN), SERVED)]
    let call = 0
    stub(() => modelListReply(SERVED), () => replies[call++] as Response)
    const reply = await readReply(await handler(request()))
    expect(reply).toMatchObject({ model: SERVED, newestModel: SERVED, modelCheck: 'mismatch', checkedModel: OLDER })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(`model mismatch: served ${OLDER}, newest ${SERVED}, requested ${ALIAS}`)
  })
})
