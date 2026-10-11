import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const blobs = vi.hoisted(() => ({ getStore: vi.fn(), getDeployStore: vi.fn() }))

vi.mock('@netlify/blobs', () => ({ getStore: blobs.getStore, getDeployStore: blobs.getDeployStore }))

import { CHECKPOINT_STORE_NAME, createStore } from '../../netlify/shared/store'

const OPTIONS = { name: CHECKPOINT_STORE_NAME, consistency: 'strong' }
const host = globalThis as { Netlify?: unknown }
const savedContext = process.env.CONTEXT
const savedNetlify = host.Netlify

/** A Blobs-shaped store with nothing in it: reads are empty and writes succeed. */
function emptyBlobStore() {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => ({ modified: true })),
    delete: vi.fn(async () => undefined),
  }
}

/** Sets the deploy context the way a function sees it: on the Netlify global, or in CONTEXT. */
function deployedAs({ global, env }: { global?: string; env?: string }) {
  if (global !== undefined) host.Netlify = { context: { deploy: { context: global } } }
  if (env !== undefined) process.env.CONTEXT = env
}

beforeEach(() => {
  blobs.getStore.mockReset()
  blobs.getDeployStore.mockReset()
  blobs.getStore.mockImplementation(() => emptyBlobStore())
  blobs.getDeployStore.mockImplementation(() => emptyBlobStore())
  delete host.Netlify
  delete process.env.CONTEXT
})

afterEach(() => {
  if (savedContext === undefined) delete process.env.CONTEXT
  else process.env.CONTEXT = savedContext
  if (savedNetlify === undefined) delete host.Netlify
  else host.Netlify = savedNetlify
})

describe('the checkpoint store scope follows the deploy context', () => {
  it('a deploy preview uses a store of its own deploy, reported as blobs-deploy', () => {
    deployedAs({ env: 'deploy-preview' })

    const { kind } = createStore()

    expect(kind).toBe('blobs-deploy')
    expect(blobs.getDeployStore).toHaveBeenCalledWith(OPTIONS)
    expect(blobs.getStore).not.toHaveBeenCalled()
  })

  it('a branch deploy uses a store of its own deploy, reported as blobs-deploy', () => {
    deployedAs({ env: 'branch-deploy' })

    const { kind } = createStore()

    expect(kind).toBe('blobs-deploy')
    expect(blobs.getDeployStore).toHaveBeenCalledWith(OPTIONS)
    expect(blobs.getStore).not.toHaveBeenCalled()
  })

  it.each(['production', 'dev', 'some-other-context'])('context %s keeps the site-wide store', (context) => {
    deployedAs({ env: context })

    const { kind } = createStore()

    expect(kind).toBe('blobs')
    expect(blobs.getStore).toHaveBeenCalledWith(OPTIONS)
    expect(blobs.getDeployStore).not.toHaveBeenCalled()
  })

  it('with no context at all, keeps the site-wide store', () => {
    const { kind } = createStore()

    expect(kind).toBe('blobs')
    expect(blobs.getStore).toHaveBeenCalledWith(OPTIONS)
    expect(blobs.getDeployStore).not.toHaveBeenCalled()
  })

  it('reads the deploy context from the Netlify global when CONTEXT is unset', () => {
    deployedAs({ global: 'deploy-preview' })

    const { kind } = createStore()

    expect(kind).toBe('blobs-deploy')
    expect(blobs.getDeployStore).toHaveBeenCalledWith(OPTIONS)
    expect(blobs.getStore).not.toHaveBeenCalled()
  })

  it('the Netlify global wins over CONTEXT, so production stays on the site-wide store', () => {
    deployedAs({ global: 'production', env: 'deploy-preview' })

    const { kind } = createStore()

    expect(kind).toBe('blobs')
    expect(blobs.getStore).toHaveBeenCalledWith(OPTIONS)
    expect(blobs.getDeployStore).not.toHaveBeenCalled()
  })

  it('a token that expires in a deploy preview reopens through getDeployStore', async () => {
    deployedAs({ env: 'deploy-preview' })
    const expired = new Error('Failed to decode token: Token expired')
    blobs.getDeployStore
      .mockImplementationOnce(() => ({
        ...emptyBlobStore(),
        get: async () => {
          throw expired
        },
      }))
      .mockImplementationOnce(() => ({ ...emptyBlobStore(), get: async () => 'fresh' }))
    const { store } = createStore()

    expect(await store.get('thread/a/latest')).toBe('fresh')

    expect(blobs.getDeployStore).toHaveBeenCalledTimes(2)
    expect(blobs.getStore).not.toHaveBeenCalled()
  })
})
