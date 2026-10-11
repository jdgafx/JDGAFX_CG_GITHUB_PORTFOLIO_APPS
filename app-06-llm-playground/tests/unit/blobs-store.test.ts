import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A stand-in for the @netlify/blobs module with the real contract: a refused conditional write RESOLVES with
// { modified: false } and does not throw, so an adapter that ignores the result would count a lost race as a win.
// getStore opens the site store and getDeployStore opens a store scoped to one deploy. Each records its own calls.
const calls: { name: string; consistency: string }[] = []
const deployCalls: { name: string; consistency: string }[] = []
const values = new Map<string, string>()
const tags = new Map<string, string>()
let counter = 0
const put = (key: string, value: string) => {
  values.set(key, value)
  tags.set(key, `etag-${++counter}`)
}
vi.mock('@netlify/blobs', () => {
  const fakeStore = () => ({
    async get(key: string) {
      return values.has(key) ? (values.get(key) as string) : null
    },
    async getWithMetadata(key: string) {
      return values.has(key) ? { data: values.get(key) as string, etag: tags.get(key) } : null
    },
    async set(key: string, value: string, o: { onlyIfNew?: boolean; onlyIfMatch?: string } = {}) {
      if (o.onlyIfNew && values.has(key)) return { modified: false }
      if (o.onlyIfMatch !== undefined && tags.get(key) !== o.onlyIfMatch) return { modified: false }
      put(key, value)
      return { modified: true, etag: tags.get(key) }
    },
    async delete(key: string) {
      values.delete(key)
    },
    list() {
      return (async function* pages() {
        yield { blobs: [...values.keys()].map(key => ({ key })), directories: [] }
      })()
    },
  })
  return {
    getStore: (options: { name: string; consistency: string }) => {
      calls.push(options)
      return fakeStore()
    },
    getDeployStore: (options: { name: string; consistency: string }) => {
      deployCalls.push(options)
      return fakeStore()
    },
  }
})

const savedContext = process.env.CONTEXT

beforeEach(() => {
  calls.length = 0
  deployCalls.length = 0
  values.clear()
  tags.clear()
  delete process.env.CONTEXT
})

afterEach(() => {
  if (savedContext === undefined) delete process.env.CONTEXT
  else process.env.CONTEXT = savedContext
  vi.unstubAllGlobals()
})

describe('Netlify Blobs adapter', () => {
  it('reports a lost conditional write as false, for setIfNew and for setIfMatch', async () => {
    const { createStore } = await import('../../netlify/shared/store')
    const { store, kind } = createStore()
    expect(kind).toBe('blobs')
    expect(await store.setIfNew('k', 'one')).toBe(true)
    expect(await store.setIfNew('k', 'two')).toBe(false)
    expect(await store.get('k')).toBe('one')
    const tagged = await store.getTagged('k')
    expect(await store.setIfMatch('k', 'three', 'stale')).toBe(false)
    expect(await store.setIfMatch('k', 'three', tagged?.etag ?? '')).toBe(true)
  })

  it('opens the store strongly consistent, and opens a new one for every request', async () => {
    const { activeStore } = await import('../../netlify/shared/store')
    activeStore()
    activeStore()
    expect(calls).toHaveLength(2)
    expect(calls.every(c => c.name === 'modelarena-arena' && c.consistency === 'strong')).toBe(true)
  })

  it('counts every one of many simultaneous ballots through the real adapter', async () => {
    const { createStore } = await import('../../netlify/shared/store')
    const { castBallot, readBoard } = await import('../../netlify/shared/arena')
    const { store } = createStore()
    const entries = [{ model: 'a', served: null }, { model: 'b', served: null }]
    const expiry = Date.now() + 60_000
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        castBallot(store, 'blobs', { runId: `${expiry}-00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, entries, outcome: { winner: i % 2 }, tie: false }, 1_000 + i),
      ),
    )
    expect(results.every(r => r.kind === 'counted')).toBe(true)
    expect((await readBoard(store, 'blobs')).ballots).toBe(20)
  })
})

describe('deploy-scoped store by deploy context', () => {
  const name = { name: 'modelarena-arena', consistency: 'strong' }

  it('opens a deploy-scoped store for a deploy preview', async () => {
    process.env.CONTEXT = 'deploy-preview'
    const { createStore } = await import('../../netlify/shared/store')
    expect(createStore().kind).toBe('blobs-deploy')
    expect(deployCalls).toEqual([name])
    expect(calls).toHaveLength(0)
  })

  it('opens a deploy-scoped store for a branch deploy', async () => {
    process.env.CONTEXT = 'branch-deploy'
    const { createStore } = await import('../../netlify/shared/store')
    expect(createStore().kind).toBe('blobs-deploy')
    expect(deployCalls).toEqual([name])
    expect(calls).toHaveLength(0)
  })

  it('keeps the site store for production', async () => {
    process.env.CONTEXT = 'production'
    const { createStore } = await import('../../netlify/shared/store')
    expect(createStore().kind).toBe('blobs')
    expect(calls).toEqual([name])
    expect(deployCalls).toHaveLength(0)
  })

  it('keeps the site store when no context is set', async () => {
    const { createStore } = await import('../../netlify/shared/store')
    expect(createStore().kind).toBe('blobs')
    expect(calls).toEqual([name])
    expect(deployCalls).toHaveLength(0)
  })

  it.each(['dev', 'Deploy-Preview', ''])('keeps the site store for the unknown context %j', async (context) => {
    process.env.CONTEXT = context
    const { createStore } = await import('../../netlify/shared/store')
    expect(createStore().kind).toBe('blobs')
    expect(calls).toEqual([name])
    expect(deployCalls).toHaveLength(0)
  })

  it('reads the runtime deploy context when CONTEXT is unset', async () => {
    vi.stubGlobal('Netlify', { context: { deploy: { context: 'deploy-preview' } } })
    const { createStore } = await import('../../netlify/shared/store')
    expect(createStore().kind).toBe('blobs-deploy')
    expect(deployCalls).toEqual([name])
    expect(calls).toHaveLength(0)
  })

  it('the runtime global wins over CONTEXT, so production keeps the site store', async () => {
    vi.stubGlobal('Netlify', { context: { deploy: { context: 'production' } } })
    process.env.CONTEXT = 'deploy-preview'
    const { createStore } = await import('../../netlify/shared/store')
    expect(createStore().kind).toBe('blobs')
    expect(calls).toEqual([name])
    expect(deployCalls).toHaveLength(0)
  })

  it('the runtime global wins over CONTEXT, so a deploy preview keeps its deploy store', async () => {
    vi.stubGlobal('Netlify', { context: { deploy: { context: 'deploy-preview' } } })
    process.env.CONTEXT = 'production'
    const { createStore } = await import('../../netlify/shared/store')
    expect(createStore().kind).toBe('blobs-deploy')
    expect(deployCalls).toEqual([name])
    expect(calls).toHaveLength(0)
  })

  it('opens a new deploy-scoped store for every request, not the in-memory fallback', async () => {
    process.env.CONTEXT = 'deploy-preview'
    const { activeStore } = await import('../../netlify/shared/store')
    const first = activeStore()
    const second = activeStore()
    expect(first.kind).toBe('blobs-deploy')
    expect(second.kind).toBe('blobs-deploy')
    expect(second).not.toBe(first)
    expect(deployCalls).toHaveLength(2)
  })
})
