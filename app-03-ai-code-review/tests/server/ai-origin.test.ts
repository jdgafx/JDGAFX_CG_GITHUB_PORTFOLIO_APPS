import { describe, expect, it } from 'vitest'
import { DIVIDE_BODY, handler, installHooks, post, readPayload } from './harness'

installHooks()

// A deploy preview answers from its own address, so its origin is the request's origin, whatever the production list says.
const PREVIEW = 'https://deploy-preview-9--jdgafx-app-03-ai-code-review.netlify.app'
const OTHER_PREVIEW = 'https://deploy-preview-10--jdgafx-app-03-ai-code-review.netlify.app'
const PRODUCTION = 'https://jdgafx-app-03-ai-code-review.netlify.app'

describe('ai function: origins', () => {
  it('allows a request from its own deploy preview origin', async () => {
    const res = await handler(post('not json', { origin: PREVIEW, url: `${PREVIEW}/api/ai` }))
    expect(res.status).toBe(400)
    expect((await readPayload(res)).error).toBe('Request body was not valid JSON.')
  })

  it('refuses a foreign origin, even when the request itself is on a deploy preview', async () => {
    const res = await handler(post(DIVIDE_BODY, { origin: 'https://evil.example', url: `${PREVIEW}/api/ai` }))
    expect(res.status).toBe(403)
    expect((await readPayload(res)).error).toBe('Origin not allowed.')
  })

  it('refuses another preview origin, which is not the request own origin', async () => {
    const res = await handler(post(DIVIDE_BODY, { origin: OTHER_PREVIEW, url: `${PREVIEW}/api/ai` }))
    expect(res.status).toBe(403)
  })

  it('still allows the production origin', async () => {
    const res = await handler(post('not json', { origin: PRODUCTION }))
    expect(res.status).toBe(400)
  })

  it('keeps the behaviour for a request with no Origin header', async () => {
    const res = await handler(post('not json', { origin: null }))
    expect(res.status).toBe(400)
  })
})
