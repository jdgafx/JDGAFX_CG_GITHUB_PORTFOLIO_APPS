import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAliasTargetSource, LIST_CACHE_MS, LIST_TIMEOUT_MS, MODEL_LIST_URL, newestModel, parseAliasTargets, servedCheck } from '../../netlify/shared/newest-model'
import { MODEL } from '../../netlify/shared/provider'

const NEWEST = 'anthropic/claude-haiku-5.6'
const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'
const LIST = {
  data: [
    { id: 'anthropic/claude-haiku-5.5', pricing: { prompt: '0.000001', completion: '0.000005' } },
    { id: MODEL, pricing: { prompt: '-1', completion: '-1' }, alias_target: { slug: NEWEST } },
  ],
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function list(body: unknown = LIST, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('parseAliasTargets', () => {
  it('maps each alias id to the slug of its alias_target', () => {
    const targets = parseAliasTargets(LIST)
    expect(targets?.get(MODEL)).toBe(NEWEST)
    expect(targets?.has('anthropic/claude-haiku-5.5')).toBe(false)
  })

  it('reads nothing from an entry with no alias_target slug, or from a body that is not a list', () => {
    expect(parseAliasTargets({ data: [{ id: MODEL, alias_target: { slug: 3 } }, { alias_target: { slug: NEWEST } }, null] })).toBeNull()
    expect(parseAliasTargets({ data: 'many' })).toBeNull()
    expect(parseAliasTargets(null)).toBeNull()
    expect(parseAliasTargets('models')).toBeNull()
  })
})

describe('newestModel', () => {
  it('returns the alias target of the requested alias, fetched with the bot user agent and no key', async () => {
    fetchMock.mockResolvedValueOnce(list())
    await expect(newestModel(createAliasTargetSource())).resolves.toBe(NEWEST)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(MODEL_LIST_URL)
    expect((init?.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT)
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('returns null when the list has no entry for the requested alias', async () => {
    fetchMock.mockResolvedValueOnce(list({ data: [LIST.data[0]] }))
    await expect(newestModel(createAliasTargetSource())).resolves.toBeNull()
  })

  it('returns null on a bad status, unreadable JSON or a refused request, and never throws', async () => {
    fetchMock.mockResolvedValueOnce(list(LIST, 503))
    fetchMock.mockResolvedValueOnce(new Response('<html>not json</html>', { status: 200 }))
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(newestModel(createAliasTargetSource())).resolves.toBeNull()
    await expect(newestModel(createAliasTargetSource())).resolves.toBeNull()
    await expect(newestModel(createAliasTargetSource())).resolves.toBeNull()
  })

  it('returns null when the list does not answer within its limit', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined))
    const pending = newestModel(createAliasTargetSource())
    await vi.advanceTimersByTimeAsync(LIST_TIMEOUT_MS)
    await expect(pending).resolves.toBeNull()
  })

  it('keeps a successful list for an hour, then fetches it again', async () => {
    let clock = 1_000
    fetchMock.mockImplementation(async () => list())
    const source = createAliasTargetSource(undefined, () => clock)

    await expect(newestModel(source)).resolves.toBe(NEWEST)
    clock += LIST_CACHE_MS - 1
    await expect(newestModel(source)).resolves.toBe(NEWEST)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    clock += 1
    await expect(newestModel(source)).resolves.toBe(NEWEST)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not keep a list that lacks the requested alias, so the next call fetches again', async () => {
    const otherAlias = { id: '~anthropic/claude-sonnet-latest', alias_target: { slug: 'anthropic/claude-sonnet-5.5' } }
    fetchMock.mockImplementationOnce(async () => list({ data: [otherAlias] }))
    fetchMock.mockImplementationOnce(async () => list())
    const source = createAliasTargetSource()

    await expect(newestModel(source)).resolves.toBeNull()
    await expect(newestModel(source)).resolves.toBe(NEWEST)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not keep a failed fetch, so the next call asks again', async () => {
    fetchMock.mockResolvedValueOnce(list(LIST, 500))
    fetchMock.mockResolvedValueOnce(list())
    const source = createAliasTargetSource()

    await expect(newestModel(source)).resolves.toBeNull()
    await expect(newestModel(source)).resolves.toBe(NEWEST)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('servedCheck', () => {
  it('reports not-reported when the reply named no model, whatever the list says', () => {
    expect(servedCheck(NEWEST, null)).toBe('not-reported')
    expect(servedCheck(null, null)).toBe('not-reported')
  })

  it('reports unchecked when the list gave no newest model', () => {
    expect(servedCheck(null, 'anthropic/claude-haiku-5.5')).toBe('unchecked')
  })

  it('reports match when the served model is the newest, and mismatch when it is not', () => {
    expect(servedCheck(NEWEST, NEWEST)).toBe('match')
    expect(servedCheck(NEWEST, 'anthropic/claude-haiku-5.5')).toBe('mismatch')
  })
})
