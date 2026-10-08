interface PlaybackProps {
  speaking: boolean
  clearDisabled: boolean
  onStop: () => void
  onClear: () => void
}

export default function Playback({ speaking, clearDisabled, onStop, onClear }: PlaybackProps) {
  return (
    <section className="ds-section" aria-labelledby="playback-title">
      <div className="ds-section__head">
        <h2 id="playback-title" className="ds-section__title">
          Playback and history
        </h2>
        <p className="ds-section__sub">Stop a reply while it is read aloud, or start a fresh conversation.</p>
      </div>
      <div className="vox-control">
        <button type="button" className="ds-button" onClick={onStop} disabled={!speaking} aria-describedby="stop-help">
          Stop speaking
        </button>
        <p id="stop-help" className="ds-help">
          Stops the browser reading the reply aloud. Works only while a reply is playing.
        </p>
      </div>
      <div className="vox-control">
        <button
          type="button"
          className="ds-button"
          onClick={onClear}
          disabled={clearDisabled}
          aria-describedby="clear-help"
        >
          Clear conversation
        </button>
        <p id="clear-help" className="ds-help">
          Empties the messages and the last run on this page.
        </p>
      </div>
    </section>
  )
}
