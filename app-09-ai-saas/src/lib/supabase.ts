import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

/** How long the startup reachability probe waits before giving up on the auth host. */
const AUTH_HEALTH_TIMEOUT_MS = 4000

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

/**
 * True when the auth host answers at all. Any HTTP status counts as reachable —
 * only DNS/TLS/network failures and timeouts mean the project is gone, which is
 * the case that must never leave a visitor stuck on the login form.
 *
 * Sends the anon apikey so GoTrue's health check answers instead of rejecting
 * the request outright — its CORS policy allows any origin, so a normal
 * (non-opaque) fetch is fine here and lets any HTTP status still count as
 * reachable, per the check below.
 */
export async function isAuthReachable(): Promise<boolean> {
  if (!supabase) return false

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AUTH_HEALTH_TIMEOUT_MS)
  try {
    await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: { apikey: supabaseAnonKey },
      signal: controller.signal,
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Distinguishes "the auth service could not be reached" from a genuine
 * credential rejection, which must still be shown to the user verbatim.
 */
export function isAuthNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const { name, message, status } = err as { name?: string; message?: string; status?: number }
  if (name === 'AuthRetryableFetchError') return true
  // supabase-js reports transport failures with no HTTP status of their own
  if (status === 0) return true
  return /failed to fetch|networkerror|network error|load failed|fetch failed|err_name_not_resolved/i.test(
    message ?? '',
  )
}
