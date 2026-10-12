import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { providerFetch } from '../helpers/fake-openrouter'
import { postJson, readFrames } from '../helpers/http'
import { QUESTION } from '../helpers/issues'

// Two Blobs stand-ins: the site-wide store (production) and the store of one deploy. A write lands in exactly one.
const blobs = vi.hoisted(() => ({ site: new Map<string, string>(), deploy: new Map<string, string>() }))

vi.mock('@netlify/blobs', () => {
  const storeOver = (values: Map<string, string>) => ({
    get: async (key: string) => values.get(key) ?? null,
    getWithMetadata: async (key: string) => (values.has(key) ? { data: values.get(key) as string, etag: 'tag', metadata: {} } : null),
    set: async (key: string, value: string, options: { onlyIfNew?: boolean } = {}) => {
      if (options.onlyIfNew && values.has(key)) return { modified: false }
      values.set(key, value)
      return { modified: true }
    },
    delete: async (key: string) => void values.delete(key),
    list: (options: { prefix?: string }) => {
      const keys = [...values.keys()].filter((key) => key.startsWith(options.prefix ?? ''))
      return (async function* pages() {
        yield { blobs: keys.map((key) => ({ key, etag: 'fake' })), directories: [] }
      })()
    },
  })
  return { getStore: () => storeOver(blobs.site), getDeployStore: () => storeOver(blobs.deploy) }
})

import start from '../../netlify/functions/start'

const savedContext = process.env.CONTEXT

beforeEach(() => {
  blobs.site.clear()
  blobs.deploy.clear()
  process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // The provider answers 500: the classify call fails, and the failed attempt's spend is recorded.
  vi.stubGlobal('fetch', providerFetch({ status: 500 }))
})

afterEach(() => {
  if (savedContext === undefined) delete process.env.CONTEXT
  else process.env.CONTEXT = savedContext
  process.env.OPENROUTER_API_KEY = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the record of a failed attempt stays in the store of its own deploy', () => {
  it('writes to the deploy store, and nothing at all to production, from a deploy preview', async () => {
    process.env.CONTEXT = 'deploy-preview'
    await readFrames(await start(postJson('/api/start', { issue: QUESTION }, 'ip-spend-preview')))
    expect([...blobs.deploy.keys()].some((key) => key.startsWith('spend/'))).toBe(true)
    expect(blobs.site.size).toBe(0)
  })

  it('writes to the site store in production', async () => {
    process.env.CONTEXT = 'production'
    await readFrames(await start(postJson('/api/start', { issue: QUESTION }, 'ip-spend-prod')))
    expect([...blobs.site.keys()].some((key) => key.startsWith('spend/'))).toBe(true)
    expect(blobs.deploy.size).toBe(0)
  })
})
