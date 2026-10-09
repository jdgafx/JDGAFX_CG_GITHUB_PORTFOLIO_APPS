import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuditError, auditErrorMessage, requestAudit } from '../../src/lib/auditApi'
import { isAbortError } from '../../src/lib/api'
import type { AuditResult, Source } from '../../src/types'

const SOURCES: Source[] = [{ n: 1, title: 'T', site: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/T', snippet: 'Some text of the source.', note: 'a note' }]
const RESULT: AuditResult = { claims: [], summary: { total: 0, supported: 0, partly: 0, unsupported: 0, unchecked: 0 }, overLimit: 0, usage: {}, ms: 5 }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('requestAudit', () => {
  it('posts the report and the numbered sources without their links, and returns the result', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        report: 'Fact [1].',
        sources: [{ n: 1, title: 'T', site: 'Wikipedia', snippet: 'Some text of the source.', note: 'a note' }],
      })
      return new Response(JSON.stringify(RESULT), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await requestAudit('Fact [1].', SOURCES)).toEqual(RESULT)
    expect(fetchMock).toHaveBeenCalledWith('/.netlify/functions/audit', expect.objectContaining({ method: 'POST' }))
  })

  it('shows the server message for a failed audit and never a raw body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"The AI provider did not answer in time."}', { status: 502 })))
    await expect(requestAudit('x', SOURCES)).rejects.toThrow('The AI provider did not answer in time.')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>stack trace</html>', { status: 500 })))
    const failure = await requestAudit('x', SOURCES).catch((err: unknown) => err)
    expect(auditErrorMessage(failure)).toBe('The audit could not run. Try again.')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })))
    await expect(requestAudit('x', SOURCES)).rejects.toThrow('Rate limited, try again in a minute.')
  })

  it('refuses a reply that is not an audit result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"hello":1}', { status: 200 })))
    await expect(requestAudit('x', SOURCES)).rejects.toThrow('The audit returned something unexpected. Try again.')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 200 })))
    await expect(requestAudit('x', SOURCES)).rejects.toBeInstanceOf(AuditError)
  })

  it('says the server cannot be reached when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))))
    const failure = await requestAudit('x', SOURCES).catch((err: unknown) => err)
    expect(auditErrorMessage(failure)).toBe('Could not reach the server for the audit. Check your connection and try again.')
  })

  it('ends at the time limit even when the body never arrives', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
          },
        })
        return new Response(body, { status: 200 })
      }),
    )
    const run = requestAudit('x', SOURCES, undefined, 45_000).catch((err: unknown) => err)
    await vi.advanceTimersByTimeAsync(45_000)
    expect(auditErrorMessage(await run)).toBe('The audit took too long and was ended. Try again.')
  })

  it('ends quietly with an abort when the visitor stops it', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))))
    const controller = new AbortController()
    const run = requestAudit('x', SOURCES, controller.signal).catch((err: unknown) => err)
    controller.abort()
    expect(isAbortError(await run)).toBe(true)
  })
})
