import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import AuthPage from './components/AuthPage'
import Dashboard from './components/Dashboard'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [isDemoMode, setIsDemoMode] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleLogout = async () => {
    if (!isDemoMode) {
      await supabase.auth.signOut()
    }
    setIsDemoMode(false)
    setSession(null)
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

  return <AuthPage onDemoMode={() => setIsDemoMode(true)} />
}
