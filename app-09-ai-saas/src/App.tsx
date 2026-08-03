import { useState, useEffect, useRef } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isAuthReachable } from './lib/supabase'
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

    // Probe the auth host up front so a dead project surfaces a Demo Mode route
    // instead of a login form that can never succeed.
    isAuthReachable().then((reachable) => {
      if (!cancelled) setAuthReachable(reachable)
    })

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
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0a12' }}>
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: '#6366f1', borderTopColor: 'transparent' }}
          />
          <p style={{ color: '#64748b', fontSize: '14px' }}>Loading InsightHub...</p>
        </div>
      </div>
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
