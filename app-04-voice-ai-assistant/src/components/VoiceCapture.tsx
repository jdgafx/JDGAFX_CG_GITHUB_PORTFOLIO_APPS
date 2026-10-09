import { useRef, type RefObject } from 'react'
import { useWaveform } from '../hooks/useWaveform'
import { MAX_RECORDING_MS } from '../lib/audio'
import { formatCountdown } from '../lib/format'

const MAX_SECONDS = Math.round(MAX_RECORDING_MS / 1000)

interface VoiceCaptureProps {
  hasMic: boolean
  recording: boolean
  disabled: boolean
  msLeft: number
  analyserRef: RefObject<AnalyserNode | null>
  onToggle: () => void
}

// The media-capture component: a record control, the live level, and the time left.
export default function VoiceCapture({ hasMic, recording, disabled, msLeft, analyserRef, onToggle }: VoiceCaptureProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useWaveform(canvasRef, analyserRef, recording)
  const unavailable = !hasMic && !recording
  return (
    <section className="ds-section" aria-labelledby="voice-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 id="voice-title" className="ds-section__title">
          Ask by voice
        </h2>
      </div>
      <div className="ds-media">
        <div className="ds-row">
          <button
            type="button"
            className="ds-rec"
            aria-pressed={recording}
            aria-label={recording ? 'Stop recording' : 'Start recording'}
            aria-describedby="voice-help"
            onClick={onToggle}
            disabled={disabled || unavailable}
          />
          <div className="vox-level">
            <canvas ref={canvasRef} aria-hidden="true" />
          </div>
          <span className="ds-mono ds-num vox-clock" aria-hidden="true">
            {recording ? formatCountdown(msLeft) : '0:00'}
          </span>
        </div>
        <p id="voice-help" className="ds-help">
          {unavailable
            ? 'No microphone was found in this browser. Type your question below instead.'
            : `Press the circle, ask one question (up to ${MAX_SECONDS} seconds), press it again to finish. The clock starts then.`}
        </p>
      </div>
    </section>
  )
}
