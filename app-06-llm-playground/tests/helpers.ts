import { afterEach, beforeEach, vi } from 'vitest'

export const TEST_KEY = 'test-only-placeholder'

// Sets the placeholder key before each test and restores the saved value after it.
export function useTestKey(value: string = TEST_KEY): void {
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = value
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    if (saved === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = saved
  })
}

// Replaces global fetch. Every test that uses this asserts on the returned stub, so no real call can pass unseen.
export function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const stub = vi.fn(impl)
  vi.stubGlobal('fetch', stub)
  return stub
}
