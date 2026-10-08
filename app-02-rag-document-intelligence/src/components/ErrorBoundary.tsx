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
      <div className="ds-app">
        <header className="ds-header">
          <div className="ds-header__inner">
            <div>
              <h1 className="ds-title">DocMind</h1>
              <p className="ds-subtitle">Ask questions about a PDF or TXT. Each answer lists the passages it used.</p>
            </div>
          </div>
        </header>
        <main className="ds-main">
          <section className="ds-card ds-stack" aria-labelledby="crash-title">
            <h2 id="crash-title" className="ds-card__title">Something went wrong</h2>
            <p className="ds-hint">
              DocMind stopped on an unexpected error. Your document stays in this browser. Only passages sent
              with a question leave it. Start over to try again.
            </p>
            <div className="ds-notice ds-notice--error ds-mono docmind-wrap" role="alert">
              {error.message || 'Unknown error'}
            </div>
            <div className="ds-row">
              <button type="button" className="ds-button ds-button--primary" onClick={this.handleRetry}>
                Start over
              </button>
              <button type="button" className="ds-button" onClick={() => window.location.reload()}>
                Reload the page
              </button>
            </div>
          </section>
        </main>
        <footer className="ds-footer">
          <div className="ds-footer__inner">Christopher Gentile</div>
        </footer>
      </div>
    )
  }
}
