import { useState } from 'react'
import { motion } from 'framer-motion'
import { Mail, Lock, ArrowRight, Zap, CloudOff } from 'lucide-react'
import { supabase, isAuthNetworkError } from '../lib/supabase'

type Mode = 'login' | 'signup' | 'reset'

interface AuthPageProps {
  onDemoMode: () => void
  /** null while the startup reachability probe is still running. */
  authReachable: boolean | null
  notice?: string
}

const AUTH_UNAVAILABLE_MESSAGE =
  'Authentication is temporarily unavailable — the sign-in service could not be reached. You can continue in Demo Mode.'

const EMAIL_NOT_CONFIRMED_MESSAGE =
  "Your email isn't confirmed yet. Check your inbox or resend the confirmation."

const EMAIL_NOT_CONFIRMED_RE = /email not confirmed/i

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px 12px 40px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '10px',
  color: '#e2e8f0',
  fontSize: '14px',
  outline: 'none',
  boxSizing: 'border-box',
}

const iconStyle: React.CSSProperties = {
  position: 'absolute',
  left: '14px',
  top: '50%',
  transform: 'translateY(-50%)',
  color: '#475569',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  color: '#94a3b8',
  marginBottom: '6px',
  fontWeight: 500,
}

export default function AuthPage({ onDemoMode, authReachable, notice }: AuthPageProps) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [submitUnreachable, setSubmitUnreachable] = useState(false)
  const [emailNotConfirmed, setEmailNotConfirmed] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendMsg, setResendMsg] = useState('')

  // The startup probe catches a dead project before the visitor types anything;
  // a failed submit catches a service that dies mid-session.
  const authUnavailable = authReachable === false || submitUnreachable

  const isLogin = mode === 'login'
  const isReset = mode === 'reset'

  const switchMode = (next: Mode) => {
    setMode(next)
    setError('')
    setSuccessMsg('')
    setEmailNotConfirmed(false)
    setResendMsg('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccessMsg('')
    setEmailNotConfirmed(false)
    setResendMsg('')
    setLoading(true)

    if (!supabase) {
      setError('Authentication is not configured. Use Demo Mode instead.')
      setLoading(false)
      return
    }

    try {
      if (isReset) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        })
        if (error) throw error
        setSuccessMsg('If that email has an account, a password reset link is on its way.')
      } else if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setSuccessMsg('Check your email to confirm your account.')
      }
    } catch (err) {
      if (isAuthNetworkError(err)) {
        setSubmitUnreachable(true)
        setError(AUTH_UNAVAILABLE_MESSAGE)
      } else if (err instanceof Error && EMAIL_NOT_CONFIRMED_RE.test(err.message)) {
        setEmailNotConfirmed(true)
        setError(EMAIL_NOT_CONFIRMED_MESSAGE)
      } else {
        // Genuine credential/validation errors stay verbatim — they are actionable.
        setError(err instanceof Error ? err.message : 'Sign in failed. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (!supabase || !email) return
    setResending(true)
    setResendMsg('')
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email })
      if (error) throw error
      setResendMsg('Confirmation email sent. Check your inbox.')
    } catch (err) {
      setResendMsg(
        isAuthNetworkError(err)
          ? AUTH_UNAVAILABLE_MESSAGE
          : 'Could not resend the confirmation email. Please try again.',
      )
    } finally {
      setResending(false)
    }
  }

  const submitLabel = isReset ? 'Send reset link' : isLogin ? 'Sign in' : 'Create account'

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
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <rect x="3" y="3" width="26" height="26" rx="4" stroke="#fff" strokeWidth="1.5" fill="rgba(255,255,255,0.1)"/>
                <line x1="3" y1="11" x2="29" y2="11" stroke="#fff" strokeWidth="1" opacity="0.3"/>
                <line x1="11" y1="11" x2="11" y2="29" stroke="#fff" strokeWidth="1" opacity="0.3"/>
                <rect x="14" y="15" width="5" height="3" rx="0.5" fill="#fff" opacity="0.5"/>
                <rect x="14" y="20" width="8" height="3" rx="0.5" fill="#fff" opacity="0.7"/>
                <rect x="14" y="25" width="3" height="2" rx="0.5" fill="#c4b5fd"/>
                <path d="M5 5h4M5 7h2" stroke="#c4b5fd" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
              </svg>
            </div>
            <div>
              <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
                InsightHub
              </h1>
              <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>AI-Powered Analytics</p>
            </div>
          </div>

          {authUnavailable && (
            <div
              role="status"
              style={{
                display: 'flex',
                gap: '12px',
                padding: '14px',
                marginBottom: '24px',
                background: 'rgba(251, 191, 36, 0.08)',
                border: '1px solid rgba(251,191,36,0.25)',
                borderRadius: '12px',
              }}
            >
              <CloudOff size={18} style={{ color: '#fbbf24', flexShrink: 0, marginTop: '2px' }} />
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: '13px', fontWeight: 600, color: '#fbbf24', marginBottom: '4px' }}>
                  Authentication temporarily unavailable
                </p>
                <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '12px', lineHeight: 1.5 }}>
                  The sign-in service can't be reached right now. The full dashboard is still
                  available with the demo dataset.
                </p>
                <button
                  onClick={onDemoMode}
                  title="Open the full dashboard with the seeded demo dataset — no account required"
                  className="w-full flex items-center justify-center gap-2"
                  style={{
                    padding: '11px',
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    border: 'none',
                    borderRadius: '10px',
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Zap size={15} />
                  Continue in Demo Mode
                </button>
              </div>
            </div>
          )}

          {notice && (
            <p
              role="status"
              style={{
                fontSize: '13px',
                color: '#93c5fd',
                padding: '10px 12px',
                marginBottom: '20px',
                background: 'rgba(147, 197, 253, 0.08)',
                borderRadius: '8px',
                border: '1px solid rgba(147,197,253,0.2)',
              }}
            >
              {notice}
            </p>
          )}

          <h2 style={{ fontSize: '24px', fontWeight: 600, color: '#e2e8f0', marginBottom: '8px' }}>
            {isReset ? 'Reset password' : isLogin ? 'Welcome back' : 'Create account'}
          </h2>
          <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '28px' }}>
            {isReset
              ? "We'll email you a link to choose a new password"
              : isLogin
                ? 'Sign in to your dashboard'
                : 'Start your 14-day free trial'}
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="auth-email" style={labelStyle}>
                Email address
              </label>
              <div className="relative">
                <Mail size={16} style={iconStyle} aria-hidden="true" />
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  title="The email address for your InsightHub account"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  style={inputStyle}
                />
              </div>
            </div>

            {!isReset && (
              <div>
                <label htmlFor="auth-password" style={labelStyle}>
                  Password
                </label>
                <div className="relative">
                  <Lock size={16} style={iconStyle} aria-hidden="true" />
                  <input
                    id="auth-password"
                    name="password"
                    type="password"
                    autoComplete={isLogin ? 'current-password' : 'new-password'}
                    placeholder="At least 6 characters"
                    title={
                      isLogin
                        ? 'The password for your account'
                        : 'Choose a password of at least 6 characters'
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    style={inputStyle}
                  />
                </div>
              </div>
            )}

            {error && (
              <p
                role="alert"
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

            {emailNotConfirmed && (
              <button
                type="button"
                onClick={handleResend}
                disabled={resending}
                title="Send a new confirmation email to this address"
                style={{
                  padding: '10px 12px',
                  background: 'rgba(99,102,241,0.08)',
                  border: '1px solid rgba(99,102,241,0.3)',
                  borderRadius: '8px',
                  color: '#818cf8',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: resending ? 'not-allowed' : 'pointer',
                }}
              >
                {resending ? 'Sending…' : 'Resend confirmation email'}
              </button>
            )}

            {resendMsg && (
              <p role="status" style={{ fontSize: '12px', color: '#94a3b8' }}>
                {resendMsg}
              </p>
            )}

            {successMsg && (
              <p
                role="status"
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
              title={loading ? 'Working…' : submitLabel}
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
              {loading ? 'Loading...' : submitLabel}
              {!loading && <ArrowRight size={16} />}
            </button>
          </form>

          {isLogin && (
            <button
              onClick={() => switchMode('reset')}
              title="Email yourself a link to reset your password"
              style={{
                display: 'block',
                margin: '14px auto 0',
                background: 'none',
                border: 'none',
                color: '#818cf8',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              Forgot your password?
            </button>
          )}

          {isReset && (
            <button
              onClick={() => switchMode('login')}
              title="Return to the sign-in form"
              style={{
                display: 'block',
                margin: '14px auto 0',
                background: 'none',
                border: 'none',
                color: '#818cf8',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              Back to sign in
            </button>
          )}

          <div className="flex items-center gap-3 my-6">
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
            <span style={{ fontSize: '12px', color: '#475569' }}>or</span>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
          </div>

          <button
            onClick={onDemoMode}
            title="Open the full dashboard with the seeded demo dataset — no account required"
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

          {!isReset && (
            <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: '#475569' }}>
              {isLogin ? "Don't have an account? " : 'Already have an account? '}
              <button
                onClick={() => switchMode(isLogin ? 'signup' : 'login')}
                title={isLogin ? 'Switch to the sign-up form' : 'Switch to the sign-in form'}
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
          )}
        </div>
      </motion.div>
    </div>
  )
}
