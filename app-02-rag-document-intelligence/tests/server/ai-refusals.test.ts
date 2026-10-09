import { describe, it, expect } from 'vitest'
import handler from '../../netlify/functions/ai'
import { MAX_BODY_BYTES } from '../../netlify/shared/http'
import { installProviderStub, request, upstream, VALID, ORIGIN } from './helpers'

installProviderStub()

describe('ai function: request refusals', () => {
  it('answers 405 to GET and never calls the provider', async () => {
    const res = await handler(new Request('http://localhost/api/ai', { method: 'GET', headers: { Origin: ORIGIN } }))
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
    expect(await res.json()).toEqual({ error: 'Method not allowed.' })
    expect(upstream()).not.toHaveBeenCalled()
  })

  it('answers 403 to an origin that is not allowed, with no CORS header to echo it', async () => {
    const res = await handler(request(VALID, { origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(await res.json()).toEqual({ error: 'Origin not allowed.' })
    expect(upstream()).not.toHaveBeenCalled()
  })

  it('does not answer an OPTIONS preflight, since only this site calls the endpoint', async () => {
    const res = await handler(new Request('http://localhost/api/ai', { method: 'OPTIONS', headers: { Origin: ORIGIN } }))
    expect(res.status).toBe(405)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('answers 400 with its own message for text that is not JSON', async () => {
    const res = await handler(request(undefined, { rawBody: '{"question": ' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid JSON in request body.' })
    expect(upstream()).not.toHaveBeenCalled()
  })

  it('answers 400 with its own message for a blank question', async () => {
    const res = await handler(request({ ...VALID, question: '  ' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'A question is required.' })
    expect(upstream()).not.toHaveBeenCalled()
  })

  it('answers 400 for a passage without its [Chunk N] label', async () => {
    const res = await handler(request({ ...VALID, chunks: ['No label here.'] }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Each document passage must start with its [Chunk N] label.' })
    expect(upstream()).not.toHaveBeenCalled()
  })

  it('answers 413 when the declared Content-Length is over the limit', async () => {
    const res = await handler(request(VALID, { headers: { 'content-length': String(MAX_BODY_BYTES + 1) } }))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'The request is too large. Try a shorter question.' })
    expect(upstream()).not.toHaveBeenCalled()
  })

  it('answers 413 when the body is over the limit, whatever the header says', async () => {
    const res = await handler(request({ ...VALID, documentTitle: 'x'.repeat(MAX_BODY_BYTES) }))
    expect(res.status).toBe(413)
    expect(upstream()).not.toHaveBeenCalled()
  })

  it('answers 500 with a plain message when no key is configured, and never calls the provider', async () => {
    delete process.env.OPENROUTER_API_KEY
    const res = await handler(request(VALID))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'The document assistant is not configured on this deployment.' })
    expect(upstream()).not.toHaveBeenCalled()
  })

  it('answers 500 with a generic message when something unexpected throws', async () => {
    const broken = { method: 'POST', headers: { get: () => { throw new Error('headers unavailable') } } } as unknown as Request
    const res = await handler(broken)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'The document assistant failed. Please try again.' })
    expect(upstream()).not.toHaveBeenCalled()
  })
})
