import { useState, useEffect, useRef } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import AppShell from './components/AppShell'
import AuthPage from './components/AuthPage'
import Dashboard from './components/Dashboard'

const SESSION_EXPIRED_NOTICE = 'Your session expired, so you were signed out. Please sign in again.'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [isDemoMode, setIsDemoMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [authReachable, setAuthReachable] = useState<boolean | null>(null)
  const [notice, setNotice] = useState('')

  // Tracked in refs so the auth listener can tell an expiry apart from a
  // sign-out the user asked for, without re-subscribing on every render.
  const hadSessionRef = useRef(false)
  const userSignedOutRef = useRef(false)

  useEffect(() => {
    if (!supabase) {
      // No Supabase configured — go straight to demo mode
      setIsDemoMode(true)
      setAuthReachable(false)
      setLoading(false)
      return
    }

    let cancelled = false

    // Seed before the async session check below resolves: a dead/expired token
    // in localStorage means SIGNED_OUT can fire before getSession() ever sets
    // this from a real session, and that must still read as an expiry.
    hadSessionRef.current = Object.keys(localStorage).some(
      (k) => k.startsWith('sb-') && k.endsWith('-auth-token'),
    )

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return
        hadSessionRef.current = Boolean(session)
        setSession(session)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setAuthReachable(false)
        setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT' && hadSessionRef.current && !userSignedOutRef.current) {
        setNotice(SESSION_EXPIRED_NOTICE)
      }
      if (nextSession) setNotice('')
      hadSessionRef.current = Boolean(nextSession)
      setSession(nextSession)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const handleLogout = async () => {
    userSignedOutRef.current = true
    setNotice('')
    if (!isDemoMode && supabase) {
      try {
        await supabase.auth.signOut()
      } catch {
        // Sign out failed, clear local state anyway
      }
    }
    setIsDemoMode(false)
    setSession(null)
    hadSessionRef.current = false
    userSignedOutRef.current = false
  }

  if (loading) {
    return (
      <AppShell purpose="Checking your session">
        <p role="status" className="ds-empty">Loading InsightHub…</p>
      </AppShell>
    )
  }

  if (session || isDemoMode) {
    return (
      <Dashboard
        onLogout={handleLogout}
        isDemoMode={isDemoMode}
        userEmail={session?.user?.email}
      />
    )
  }

  return (
    <AuthPage
      onDemoMode={() => setIsDemoMode(true)}
      authReachable={authReachable}
      notice={notice}
    />
  )
}
