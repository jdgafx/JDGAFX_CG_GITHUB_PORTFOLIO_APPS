import { describe, it, expect, afterEach } from 'vitest'
import { clientKey, corsHeaders, MAX_BODY_BYTES, originAllowed, rateLimited, readJsonBody, validate } from '../../netlify/shared/http'

const VALID = {
  question: 'In what year was the Harbor Station opened?',
  chunks: ['[Chunk 4]:\nThe Harbor Station was opened in 1987.', '[Chunk 9]:\nLisbon is the capital.'],
  documentTitle: 'harbor.pdf',
}

describe('validate', () => {
  it('accepts a labelled request and returns the passage numbers in order', () => {
    expect(validate(VALID)).toEqual({ ok: true, value: { ...VALID, chunkIndices: [4, 9] } })
  })

  it('ignores any model name the client sends', () => {
    const result = validate({ ...VALID, model: 'some/other-model' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(Object.keys(result.value).sort()).toEqual(['chunkIndices', 'chunks', 'documentTitle', 'question'])
  })

  it('rejects a body that is not an object', () => {
    for (const body of [null, 'text', ['question']]) {
      expect(validate(body)).toEqual({ ok: false, status: 400, message: 'Request body must be a JSON object.' })
    }
  })

  it('rejects a missing or blank question, and one over 2000 characters', () => {
    expect(validate({ ...VALID, question: '   ' })).toEqual({ ok: false, status: 400, message: 'A question is required.' })
    expect(validate({ ...VALID, question: 'q'.repeat(2001) })).toEqual({
      ok: false,
      status: 400,
      message: 'The question must be 2000 characters or fewer.',
    })
  })

  it('rejects passages that are not a non-empty list', () => {
    expect(validate({ ...VALID, chunks: 'text' })).toEqual({
      ok: false,
      status: 400,
      message: 'chunks must be an array of document passages.',
    })
    expect(validate({ ...VALID, chunks: [] })).toEqual({ ok: false, status: 400, message: 'No document passages were provided.' })
  })

  it('rejects more than 20 passages with 413', () => {
    const chunks = Array.from({ length: 21 }, (_, i) => `[Chunk ${i}]:\ntext`)
    expect(validate({ ...VALID, chunks })).toEqual({
      ok: false,
      status: 413,
      message: 'At most 20 document passages can be sent per question.',
    })
  })

  it('rejects a passage that is not text', () => {
    expect(validate({ ...VALID, chunks: [42] })).toEqual({ ok: false, status: 400, message: 'Each document passage must be text.' })
  })

  it('rejects a passage without its [Chunk N] label', () => {
    expect(validate({ ...VALID, chunks: ['No label here.'] })).toEqual({
      ok: false,
      status: 400,
      message: 'Each document passage must start with its [Chunk N] label.',
    })
  })

  it('rejects a missing document title', () => {
    expect(validate({ ...VALID, documentTitle: '' })).toEqual({ ok: false, status: 400, message: 'A document title is required.' })
  })

  it('cuts overlong passages to 2000 characters and overlong titles to 200', () => {
    const result = validate({ ...VALID, chunks: [`[Chunk 0]:\n${'y'.repeat(2500)}`], documentTitle: 'x'.repeat(250) })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.chunks[0]).toHaveLength(2000)
      expect(result.value.documentTitle).toHaveLength(200)
    }
  })
})

describe('readJsonBody', () => {
  it('parses a JSON body', async () => {
    const req = new Request('http://localhost/api/ai', { method: 'POST', body: '{"a":1}' })
    expect(await readJsonBody(req)).toEqual({ ok: true, body: { a: 1 } })
  })

  it('returns 400 for text that is not JSON', async () => {
    const req = new Request('http://localhost/api/ai', { method: 'POST', body: '{"a":' })
    expect(await readJsonBody(req)).toEqual({ ok: false, status: 400, message: 'Invalid JSON in request body.' })
  })

  it('returns 413 when the declared Content-Length is over the limit', async () => {
    const req = new Request('http://localhost/api/ai', {
      method: 'POST',
      body: '{}',
      headers: { 'content-length': String(MAX_BODY_BYTES + 1) },
    })
    expect(await readJsonBody(req)).toEqual({ ok: false, status: 413, message: 'The request is too large. Try a shorter question.' })
  })

  it('returns 413 when the body itself is over the limit, whatever the header says', async () => {
    const big = JSON.stringify({ question: 'q'.repeat(MAX_BODY_BYTES) })
    const req = new Request('http://localhost/api/ai', { method: 'POST', body: big })
    expect(await readJsonBody(req)).toEqual({ ok: false, status: 413, message: 'The request is too large. Try a shorter question.' })
  })
})

describe('originAllowed and corsHeaders', () => {
  const previous = process.env.ALLOWED_ORIGINS

  afterEach(() => {
    if (previous === undefined) delete process.env.ALLOWED_ORIGINS
    else process.env.ALLOWED_ORIGINS = previous
  })

  it('allows requests with no Origin header and the local dev origins', () => {
    expect(originAllowed(null)).toBe(true)
    expect(originAllowed('http://localhost:5173')).toBe(true)
    expect(originAllowed('http://localhost:5173/')).toBe(true)
  })

  it('refuses an origin that is not on the list', () => {
    expect(originAllowed('https://evil.example')).toBe(false)
  })

  it('allows an origin named in ALLOWED_ORIGINS, with or without a trailing slash', () => {
    process.env.ALLOWED_ORIGINS = 'https://docmind.example.com/'
    expect(originAllowed('https://docmind.example.com')).toBe(true)
  })

  it('echoes an allowed origin in the CORS header, and omits it when there is no origin', () => {
    expect(corsHeaders('https://docmind.example.com')).toEqual({
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
      'Access-Control-Allow-Origin': 'https://docmind.example.com',
    })
    expect(corsHeaders(null)).not.toHaveProperty('Access-Control-Allow-Origin')
  })
})

describe('rateLimited and clientKey', () => {
  it('allows 20 requests a minute per key and refuses the 21st', () => {
    const results = Array.from({ length: 21 }, () => rateLimited('unit-test-key-a'))
    expect(results.slice(0, 20).every(limited => limited === false)).toBe(true)
    expect(results[20]).toBe(true)
  })

  it('keys on the Netlify client IP first, then the first forwarded address', () => {
    const both = new Request('http://localhost/api/ai', {
      headers: { 'x-nf-client-connection-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.7, 10.0.0.1' },
    })
    const forwarded = new Request('http://localhost/api/ai', { headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' } })
    const neither = new Request('http://localhost/api/ai')
    expect(clientKey(both)).toBe('203.0.113.9')
    expect(clientKey(forwarded)).toBe('198.51.100.7')
    expect(clientKey(neither)).toBe('unknown')
  })
})
