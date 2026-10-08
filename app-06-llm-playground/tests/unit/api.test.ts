import { describe, expect, it } from 'vitest'
import { ApiError, fetchCatalogue, isAbortError, runCompare } from '../../src/lib/api'
import { stubFetch } from '../helpers'

const REQUEST = { prompt: 'Hi', models: ['a/x', 'b/y', 'c/z'] as [string, string, string] }

describe('client requests', () => {
  it('posts the compare request as JSON and returns the parsed body', async () => {
    const stub = stubFetch(async () => Response.json({ runId: 'r1', panels: [] }))
    expect(await runCompare(REQUEST)).toEqual({ runId: 'r1', panels: [] })
    expect(stub).toHaveBeenCalledTimes(1)
    const [url, init] = stub.mock.calls[0]
    expect(url).toBe('/api/compare')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(REQUEST)
  })

  it('reads the model list from /api/models', async () => {
    const stub = stubFetch(async () => Response.json({ source: 'live', groups: [] }))
    expect(await fetchCatalogue()).toEqual({ source: 'live', groups: [] })
    expect(stub).toHaveBeenCalledTimes(1)
    expect(stub.mock.calls[0][0]).toBe('/api/models')
  })
})

describe('client error messages', () => {
  it('says the server could not be reached when the network call fails', async () => {
    const stub = stubFetch(async () => {
      throw new TypeError('fetch failed')
    })
    const failure = runCompare(REQUEST)
    await expect(failure).rejects.toBeInstanceOf(ApiError)
    await expect(failure).rejects.toThrow('Could not reach the server. Check your connection and try again.')
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('lets an abort through unchanged, so Stop is not shown as an error', async () => {
    const stub = stubFetch(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    })
    await expect(runCompare(REQUEST)).rejects.toMatchObject({ name: 'AbortError' })
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('shows the plain message from a JSON error body', async () => {
    const stub = stubFetch(async () => Response.json({ error: 'Prompt must be 1 to 4000 characters' }, { status: 400 }))
    await expect(runCompare(REQUEST)).rejects.toThrow('Prompt must be 1 to 4000 characters')
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('explains a gateway timeout, whose body is an HTML page', async () => {
    const stub = stubFetch(async () => new Response('<html>504 Gateway Timeout</html>', { status: 504 }))
    await expect(runCompare(REQUEST)).rejects.toThrow('The server did not answer in time. Try again, or use a shorter prompt.')
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('gives only the status for an error without a message', async () => {
    const stub = stubFetch(async () => new Response('oops', { status: 500 }))
    await expect(fetchCatalogue()).rejects.toThrow('Request failed with status 500')
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('says so when a successful reply cannot be read', async () => {
    const stub = stubFetch(async () => new Response('not json', { status: 200 }))
    await expect(fetchCatalogue()).rejects.toThrow('The server sent a reply that could not be read. Try again.')
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('recognises an abort by its name only', () => {
    expect(isAbortError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true)
    expect(isAbortError(new Error('x'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
  })
})
