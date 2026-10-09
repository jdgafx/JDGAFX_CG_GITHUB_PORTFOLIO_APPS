import { Mic, Square } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface DockProps {
  recording: boolean
  busy: boolean
  hasMic: boolean
  canAsk: boolean
  onFinishRecording: () => void
  onRecord: () => void
  onStop: () => void
}

// The action dock: Ask is the one filled button. While recording it becomes Stop recording; while a run is on,
// one Stop ends the stream and the voice together and takes focus, without scrolling the page.
export default function Dock({ recording, busy, hasMic, canAsk, onFinishRecording, onRecord, onStop }: DockProps) {
  const stopRef = useRef<HTMLButtonElement>(null)
  const running = busy && !recording
  useEffect(() => {
    if (running) stopRef.current?.focus({ preventScroll: true })
  }, [running])

  return (
    <div className="ds-actions">
      {recording ? (
        <button type="button" className="ds-button ds-button--primary" onClick={onFinishRecording} title="Ends the recording and sends it to be transcribed.">
          <Square size={16} aria-hidden="true" />
          Stop recording
        </button>
      ) : (
        <button
          type="submit"
          form="ask-form"
          className="ds-button ds-button--primary"
          disabled={!canAsk || busy}
          aria-busy={running}
          title="Sends the typed question. The answer streams in and is spoken as it arrives."
        >
          {running ? 'Working' : 'Ask'}
        </button>
      )}
      {running ? (
        <button type="button" className="ds-button" ref={stopRef} onClick={onStop} title="Ends the stream and the voice together. What had arrived stays on screen.">
          <Square size={16} aria-hidden="true" />
          Stop
        </button>
      ) : !recording ? (
        <button
          type="button"
          className="ds-button"
          onClick={onRecord}
          disabled={!hasMic || busy}
          title="Records one spoken question. The clock for time to first audio starts when you stop speaking."
        >
          <Mic size={16} aria-hidden="true" />
          Record
        </button>
      ) : null}
    </div>
  )
}
