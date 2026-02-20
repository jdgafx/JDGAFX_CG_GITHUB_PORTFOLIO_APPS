import { useState } from 'react'
import { motion } from 'framer-motion'
import { BarChart3, Mail, Lock, ArrowRight, Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface AuthPageProps {
  onDemoMode: () => void
}

export default function AuthPage({ onDemoMode }: AuthPageProps) {
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccessMsg('')
    setLoading(true)

    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    } else {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) {
        setError(error.message)
      } else {
        setSuccessMsg('Check your email to confirm your account.')
      }
    }

    setLoading(false)
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: 'radial-gradient(ellipse at 30% 50%, #1e1b4b 0%, #0a0a12 60%)',
      }}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full opacity-10 animate-pulse"
            style={{
              width: `${80 + i * 60}px`,
              height: `${80 + i * 60}px`,
              background: 'radial-gradient(circle, #6366f1, transparent)',
              left: `${10 + i * 15}%`,
              top: `${20 + (i % 3) * 20}%`,
              animationDelay: `${i * 0.5}s`,
              animationDuration: `${3 + i}s`,
            }}
          />
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative w-full max-w-md"
      >
        <div
          className="rounded-2xl p-8"
          style={{
            background: 'rgba(15, 15, 30, 0.9)',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            boxShadow: '0 25px 50px rgba(0,0,0,0.5), 0 0 40px rgba(99,102,241,0.05)',
          }}
        >
          <div className="flex items-center gap-3 mb-8">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
            >
              <BarChart3 size={20} color="white" />
            </div>
            <div>
              <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
                InsightHub
              </h1>
              <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>AI-Powered Analytics</p>
            </div>
          </div>

          <h2 style={{ fontSize: '24px', fontWeight: 600, color: '#e2e8f0', marginBottom: '8px' }}>
            {isLogin ? 'Welcome back' : 'Create account'}
          </h2>
          <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '28px' }}>
            {isLogin ? 'Sign in to your dashboard' : 'Start your 14-day free trial'}
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="relative">
              <Mail
                size={16}
                style={{
                  position: 'absolute',
                  left: '14px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#475569',
                }}
              />
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '12px 14px 12px 40px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '10px',
                  color: '#e2e8f0',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div className="relative">
              <Lock
                size={16}
                style={{
                  position: 'absolute',
                  left: '14px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#475569',
                }}
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                style={{
                  width: '100%',
                  padding: '12px 14px 12px 40px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '10px',
                  color: '#e2e8f0',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {error && (
              <p
                style={{
                  color: '#f87171',
                  fontSize: '13px',
                  padding: '10px 12px',
                  background: 'rgba(248, 113, 113, 0.08)',
                  borderRadius: '8px',
                  border: '1px solid rgba(248,113,113,0.2)',
                }}
              >
                {error}
              </p>
            )}

            {successMsg && (
              <p
                style={{
                  color: '#34d399',
                  fontSize: '13px',
                  padding: '10px 12px',
                  background: 'rgba(52, 211, 153, 0.08)',
                  borderRadius: '8px',
                  border: '1px solid rgba(52,211,153,0.2)',
                }}
              >
                {successMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex items-center justify-center gap-2"
              style={{
                padding: '13px',
                background: loading
                  ? 'rgba(99,102,241,0.5)'
                  : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                border: 'none',
                borderRadius: '10px',
                color: 'white',
                fontSize: '15px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'opacity 0.2s',
              }}
            >
              {loading ? 'Loading...' : isLogin ? 'Sign in' : 'Create account'}
              {!loading && <ArrowRight size={16} />}
            </button>
          </form>

          <div className="flex items-center gap-3 my-6">
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
            <span style={{ fontSize: '12px', color: '#475569' }}>or</span>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
          </div>

          <button
            onClick={onDemoMode}
            className="w-full flex items-center justify-center gap-2"
            style={{
              padding: '13px',
              background: 'rgba(99,102,241,0.08)',
              border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: '10px',
              color: '#818cf8',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <Zap size={15} />
            Try Demo Mode — no account needed
          </button>

          <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: '#475569' }}>
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => {
                setIsLogin(!isLogin)
                setError('')
                setSuccessMsg('')
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#818cf8',
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: '13px',
              }}
            >
              {isLogin ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </motion.div>
    </div>
  )
}
