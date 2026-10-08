import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadSupabase() {
  vi.resetModules()
  return import('../../src/lib/supabase')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('supabase client', () => {
  it('is null when the URL is missing, so the app starts in demo mode', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-only-placeholder')
    const { supabase } = await loadSupabase()
    expect(supabase).toBeNull()
  })

  it('is null when the anon key is missing, so the app starts in demo mode', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.invalid')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const { supabase } = await loadSupabase()
    expect(supabase).toBeNull()
  })

  it('is null when both are missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const { supabase } = await loadSupabase()
    expect(supabase).toBeNull()
  })

  it('is a client when both are set', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.invalid')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-only-placeholder')
    const { supabase } = await loadSupabase()
    expect(supabase).not.toBeNull()
    expect(typeof supabase?.auth.getSession).toBe('function')
  })
})

describe('isAuthNetworkError', () => {
  it('treats transport failures as network errors', async () => {
    const { isAuthNetworkError } = await loadSupabase()
    expect(isAuthNetworkError({ name: 'AuthRetryableFetchError', message: 'x' })).toBe(true)
    expect(isAuthNetworkError({ status: 0, message: 'x' })).toBe(true)
    expect(isAuthNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isAuthNetworkError(new TypeError('net::ERR_NAME_NOT_RESOLVED'))).toBe(true)
  })

  it('keeps genuine credential rejections, and non-object values, as not network errors', async () => {
    const { isAuthNetworkError } = await loadSupabase()
    expect(isAuthNetworkError({ name: 'AuthApiError', status: 400, message: 'Invalid login credentials' })).toBe(false)
    expect(isAuthNetworkError(null)).toBe(false)
    expect(isAuthNetworkError('Failed to fetch')).toBe(false)
  })
})
