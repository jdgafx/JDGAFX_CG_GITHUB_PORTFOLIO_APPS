import { useState } from 'react'
import { supabase, isAuthNetworkError } from '../lib/supabase'
import AppShell from './AppShell'

type Mode = 'login' | 'signup' | 'reset'

interface AuthPageProps {
  onDemoMode: () => void
  /** null until the session check has answered. False when auth is off or the session check failed. */
  authReachable: boolean | null
  notice?: string
}

const AUTH_UNAVAILABLE_MESSAGE =
  'Authentication is temporarily unavailable: the sign-in service could not be reached. You can continue in demo mode.'

const EMAIL_NOT_CONFIRMED_MESSAGE =
  "Your email isn't confirmed yet. Check your inbox or resend the confirmation."

const EMAIL_NOT_CONFIRMED_RE = /email not confirmed/i

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

  // authReachable is false when auth is not configured or the startup session check fails, so the banner
  // shows before the visitor types anything. A failed submit catches a service that goes down mid-session.
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
      setError('Authentication is not configured. Use demo mode instead.')
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
        // Genuine credential/validation errors stay verbatim: they are actionable.
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
  const heading = isReset ? 'Reset password' : isLogin ? 'Welcome back' : 'Create account'
  const subheading = isReset
    ? "We'll email you a link to choose a new password"
    : isLogin
      ? 'Sign in with your email and password to open the dashboard'
      : 'Use an email address and a password of at least 6 characters'

  return (
    <AppShell
      purpose="Sign in to the analytics dashboard, or try it with demo data first."
      badge={<span className="ds-badge">Not signed in</span>}
    >
      <div className="hub-auth">
        {authUnavailable && (
          <div role="status" className="ds-notice hub-unavailable">
            <p className="hub-unavailable__title">Authentication temporarily unavailable</p>
            <p className="ds-hint">
              The sign-in service can't be reached right now. The full dashboard is still available with the demo
              dataset.
            </p>
            <button type="button" className="ds-button" onClick={onDemoMode}>
              Continue in demo mode
            </button>
          </div>
        )}

        {notice && (
          <p role="status" className="ds-notice">
            {notice}
          </p>
        )}

        <section className="ds-section" aria-labelledby="demo-title">
          <div className="ds-section__head">
            <h2 id="demo-title" className="ds-section__title">
              Demo mode
            </h2>
            <p className="ds-section__sub">
              Opens the full dashboard on the seeded demo dataset. No account is needed, and Generate insights works the
              same way.
            </p>
          </div>
          <button type="button" className="ds-button ds-button--primary hub-wide" onClick={onDemoMode}>
            Try demo mode, no account needed
          </button>
        </section>

        <div className="hub-divider">or</div>

        <section className="ds-section" aria-labelledby="auth-title">
          <div className="ds-section__head">
            <h2 id="auth-title" className="ds-section__title">
              {heading}
            </h2>
            <p className="ds-section__sub">{subheading}</p>
          </div>

          <form onSubmit={handleSubmit} className="ds-stack">
            <div className="ds-field">
              <label htmlFor="auth-email" className="ds-label">
                Email address
              </label>
              <input
                id="auth-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                className="ds-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {!isReset && (
              <div className="ds-field">
                <label htmlFor="auth-password" className="ds-label">
                  Password
                </label>
                <input
                  id="auth-password"
                  name="password"
                  type="password"
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  placeholder="At least 6 characters"
                  className="ds-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
            )}

            {error && (
              <p role="alert" className="ds-notice ds-notice--error">
                {error}
              </p>
            )}

            {emailNotConfirmed && (
              <button type="button" className="ds-button" onClick={handleResend} disabled={resending}>
                {resending ? 'Sending…' : 'Resend confirmation email'}
              </button>
            )}

            {resendMsg && (
              <p role="status" className="ds-hint">
                {resendMsg}
              </p>
            )}

            {successMsg && (
              <p role="status" className="ds-notice">
                {successMsg}
              </p>
            )}

            <button type="submit" className="ds-button hub-wide" disabled={loading}>
              {loading ? 'Working…' : submitLabel}
            </button>
          </form>

          {isLogin && (
            <button type="button" className="hub-link" onClick={() => switchMode('reset')}>
              Forgot your password?
            </button>
          )}

          {isReset && (
            <button type="button" className="hub-link" onClick={() => switchMode('login')}>
              Back to sign in
            </button>
          )}

          {!isReset && (
            <p className="ds-hint">
              {isLogin ? "Don't have an account? " : 'Already have an account? '}
              <button type="button" className="hub-link" onClick={() => switchMode(isLogin ? 'signup' : 'login')}>
                {isLogin ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          )}
        </section>
      </div>
    </AppShell>
  )
}
