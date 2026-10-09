import { Component, type ReactNode } from 'react'

interface State {
  failed: boolean
}

/** If the run column cannot draw what the server sent, the rest of the page stays and this says so, with a way out. */
export class RunBoundary extends Component<{ children: ReactNode; onReset: () => void }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.error('GraphGate: the run column could not be drawn', error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="ds-state ds-state--error" role="alert">
        <span className="ds-state__mark" aria-hidden="true" />
        <p className="ds-state__title">This result could not be shown</p>
        <p className="ds-state__body">The server sent something the page could not draw. Your saved threads are not affected.</p>
        <div className="ds-state__actions">
          <button
            type="button"
            className="ds-button ds-button--primary"
            onClick={() => {
              this.props.onReset()
              this.setState({ failed: false })
            }}
          >
            Start over
          </button>
        </div>
      </div>
    )
  }
}
