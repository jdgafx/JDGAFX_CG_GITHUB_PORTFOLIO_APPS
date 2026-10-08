import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

/** Null when either variable is missing. The app then runs in demo mode only and never calls the auth service. */
export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

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
