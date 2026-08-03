import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Catches render-time crashes so a bad document or a component bug lands the
 * user on a recovery screen instead of a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('DocMind crashed:', error, info.componentStack)
  }

  private handleRetry = () => {
    this.setState({ error: null })
  }

  override render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center"
        style={{ background: 'var(--color-bg)', fontFamily: 'var(--font-body)' }}
      >
        <h1
          className="text-2xl font-bold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
        >
          Something went wrong
        </h1>
        <p className="text-sm max-w-md" style={{ color: 'var(--color-text-secondary)' }}>
          DocMind hit an unexpected error and stopped. Your document was never uploaded anywhere,
          so nothing is left behind. Start over and try again.
        </p>
        <p
          className="text-xs max-w-md px-3 py-2 rounded-lg"
          style={{
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
          }}
        >
          {error.message || 'Unknown error'}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={this.handleRetry}
            title="Return to the upload screen and start with a fresh document"
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--color-accent)', color: '#000' }}
          >
            Start over
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            title="Reload DocMind from scratch"
            className="px-4 py-2 rounded-lg text-sm"
            style={{
              color: 'var(--color-text-secondary)',
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)',
            }}
          >
            Reload the app
          </button>
        </div>
      </div>
    )
  }
}
