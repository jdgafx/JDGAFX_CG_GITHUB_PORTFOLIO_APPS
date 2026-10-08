import { useRef, type RefObject } from 'react'
import { Loader2, Mic, Square, Volume2 } from 'lucide-react'
import { useWaveform } from '../hooks/useWaveform'
import type { AppState } from '../hooks/useAssistant'
import { formatCountdown } from '../lib/format'

interface MicPanelProps {
  appState: AppState
  hasMic: boolean
  msLeft: number
  analyserRef: RefObject<AnalyserNode | null>
  onMicClick: () => void
  onCancel: () => void
}

// Kept out of the live region on purpose: a countdown that changes every second would be read aloud.
function statusText(appState: AppState, hasMic: boolean): string {
  switch (appState) {
    case 'recording':
      return 'Recording. Tap the microphone to stop.'
    case 'transcribing':
      return 'Transcribing what you said.'
    case 'thinking':
      return 'Waiting for the answer.'
    case 'speaking':
      return 'Reading the answer aloud. Tap the microphone to stop.'
    default:
      return hasMic ? 'Tap the microphone and ask your question.' : 'No microphone found. Type your question below.'
  }
}

function buttonLabel(appState: AppState): string {
  switch (appState) {
    case 'recording':
      return 'Stop recording'
    case 'speaking':
      return 'Stop speaking'
    case 'transcribing':
    case 'thinking':
      return 'Working on your question'
    default:
      return 'Start recording'
  }
}

export default function MicPanel({ appState, hasMic, msLeft, analyserRef, onMicClick, onCancel }: MicPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useWaveform(canvasRef, analyserRef, appState === 'recording')

  const processing = appState === 'transcribing' || appState === 'thinking'
  const Icon = appState === 'recording' ? Square : appState === 'speaking' ? Volume2 : processing ? Loader2 : Mic

  return (
    <div className="ds-stack">
      <div className="vox-stage">
        <canvas ref={canvasRef} aria-hidden="true" />
      </div>
      <div className="vox-controls">
        <button
          type="button"
          className="vox-mic"
          data-state={appState}
          onClick={onMicClick}
          disabled={processing || (!hasMic && appState === 'idle')}
          aria-label={buttonLabel(appState)}
        >
          <Icon size={32} aria-hidden="true" className={processing ? 'vox-spin' : undefined} />
        </button>
        {appState === 'recording' && (
          <span className="ds-hint" aria-hidden="true">
            {formatCountdown(msLeft)} left
          </span>
        )}
        <p className="vox-status" role="status" aria-live="polite">
          {statusText(appState, hasMic)}
        </p>
        {processing && (
          <button type="button" className="ds-button" onClick={onCancel}>
            Cancel request
          </button>
        )}
      </div>
    </div>
  )
}
