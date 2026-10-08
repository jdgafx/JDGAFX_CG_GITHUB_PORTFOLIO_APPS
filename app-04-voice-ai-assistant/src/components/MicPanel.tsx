import { Loader2, Mic, Square, Volume2 } from 'lucide-react'
import type { AppState } from '../hooks/useAssistant'
import { MAX_RECORDING_MS } from '../lib/audio'
import { formatCountdown } from '../lib/format'

const MAX_RECORDING_SECONDS = Math.round(MAX_RECORDING_MS / 1000)

interface MicPanelProps {
  appState: AppState
  hasMic: boolean
  msLeft: number
  onMicClick: () => void
  onCancel: () => void
}

// The status names the same verb as the button. It stays out of the countdown, which changes every second.
function statusText(appState: AppState, hasMic: boolean): string {
  switch (appState) {
    case 'recording':
      return 'Recording. Tap Stop recording when you finish.'
    case 'transcribing':
      return 'Transcribing what you said on the server.'
    case 'thinking':
      return 'Waiting for the chat model to answer.'
    case 'speaking':
      return 'Reading the reply aloud. Tap Stop speaking to end it.'
    default:
      return hasMic
        ? 'Ready. Tap Start recording to ask by voice.'
        : 'No microphone found. Type your question below instead.'
  }
}

function buttonLabel(appState: AppState, hasMic: boolean): string {
  switch (appState) {
    case 'recording':
      return 'Stop recording'
    case 'speaking':
      return 'Stop speaking'
    case 'transcribing':
    case 'thinking':
      return 'Working on your question'
    default:
      return hasMic ? 'Start recording' : 'No microphone found'
  }
}

export default function MicPanel({ appState, hasMic, msLeft, onMicClick, onCancel }: MicPanelProps) {
  const processing = appState === 'transcribing' || appState === 'thinking'
  const recording = appState === 'recording'
  const Icon = recording ? Square : appState === 'speaking' ? Volume2 : processing ? Loader2 : Mic

  return (
    <section className="ds-section" aria-labelledby="record-title">
      <div className="ds-section__head">
        <h2 id="record-title" className="ds-section__title">
          Ask by voice
        </h2>
        <p className="ds-section__sub">Record one question from your microphone, up to {MAX_RECORDING_SECONDS} seconds.</p>
      </div>
      <button
        type="button"
        className="ds-button ds-button--primary vox-record"
        onClick={onMicClick}
        disabled={processing || (!hasMic && appState === 'idle')}
        aria-describedby="record-help"
      >
        <Icon size={20} aria-hidden="true" className={processing ? 'vox-spin' : undefined} />
        {buttonLabel(appState, hasMic)}
      </button>
      <p id="record-help" className="ds-help">
        Records until you tap stop, then transcribes the clip on the server.
      </p>
      <div className="vox-status-row">
        <p className="vox-status" role="status" aria-live="polite">
          {statusText(appState, hasMic)}
        </p>
        {recording && (
          <span className="ds-help ds-num" aria-hidden="true">
            {formatCountdown(msLeft)} left
          </span>
        )}
      </div>
      {processing && (
        <div className="vox-control">
          <button type="button" className="ds-button" onClick={onCancel} aria-describedby="cancel-help">
            Cancel request
          </button>
          <p id="cancel-help" className="ds-help">
            Stops waiting for the answer. The server call still finishes and may still be billed.
          </p>
        </div>
      )}
    </section>
  )
}
