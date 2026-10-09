import { useEffect, useState } from 'react'
import { formatMs } from '../lib/format'
import type { RunState } from '../lib/run'
import { ttfa, type Parts } from '../lib/ttfa'

const NONE = '—'

type PartKey = keyof Parts

const SEGMENTS: Array<{ key: PartKey; label: string; hint: string }> = [
  { key: 'transcribe', label: 'Transcribe', hint: 'Stop speaking to transcript' },
  { key: 'tools', label: 'Tools', hint: 'Weather or Wikipedia lookups' },
  { key: 'firstToken', label: 'First token', hint: 'Until the model writes' },
  { key: 'firstSentence', label: 'First sentence', hint: 'Until a sentence is complete' },
  { key: 'speechStart', label: 'Speech start', hint: 'Voice engine starts' },
]

/** Counts up from the origin of the clock until the voice starts. */
function LiveClock({ since }: { since: number }) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 100)
    return () => window.clearInterval(id)
  }, [])
  return <>{formatMs(Math.round(Math.max(0, now - since) / 100) * 100)}</>
}

function Cell({ label, hint, children, swatch }: { label: string; hint: string; children: React.ReactNode; swatch?: PartKey }) {
  return (
    <div className="ds-strip__item">
      <dt className="ds-strip__label">
        {swatch && <span className={`vox-swatch vox-swatch--${swatch}`} aria-hidden="true" />}
        {label}
      </dt>
      <dd className="ds-strip__value">{children}</dd>
      <dd className="ds-strip__hint">{hint}</dd>
    </div>
  )
}

/**
 * Time to first audio and the parts it is made of. The clock starts when the visitor stops speaking, or at
 * Ask for a typed question, and stops when the browser's voice starts the first sentence. On a device with no
 * voice there is no audio, so the first sentence being ready is shown instead and said so.
 */
export default function Readout({ run }: { run: RunState }) {
  const running = run.outcome === 'running'
  const started = run.outcome !== 'idle'
  const figures = ttfa(run.marks)
  const parts = figures.parts
  const waitingForAudio = running && figures.total === undefined && run.voice !== 'none'
  const noVoice = run.voice === 'none' || run.voice === 'failed'
  const voiced = run.via === 'voice'
  const tone = running ? ' ds-strip--live' : figures.total !== undefined || figures.toFirstSentence !== undefined ? '' : ' ds-strip--pending'
  const origin = run.marks.origin

  let headline: React.ReactNode = NONE
  let headLabel = 'Time to first audio'
  let headHint = 'Shown when you ask'
  if (figures.total !== undefined) {
    headline = formatMs(figures.total)
    headHint = voiced ? 'End of speech to first audio' : 'Ask to first audio'
  } else if (noVoice && figures.toFirstSentence !== undefined) {
    headline = formatMs(figures.toFirstSentence)
    headLabel = 'Time to first sentence'
    headHint = 'No voice on this device, so no audio to time'
  } else if (run.stage === 'recording') {
    headHint = 'Starts when you stop speaking'
  } else if (waitingForAudio && started) {
    headline = <LiveClock since={origin} />
    headHint = 'Running now'
  } else if (started && run.outcome !== 'running') {
    headHint = run.outcome === 'done' ? 'No sentence was spoken' : run.outcome === 'stopped' ? 'Before it stopped' : 'Before it failed'
  }

  const cells = SEGMENTS.filter(s => (s.key !== 'transcribe' || voiced) && (s.key !== 'tools' || parts.tools !== undefined))
  const total = cells.reduce((sum, s) => sum + (parts[s.key] ?? 0), 0)

  return (
    <section className="ds-section ds-run__readout vox-readout" aria-label="Time to first audio">
      <dl className={`ds-strip${tone}`}>
        <Cell label={headLabel} hint={headHint}>
          {headline}
        </Cell>
        {cells.map(s => (
          <Cell key={s.key} label={s.label} hint={s.hint} swatch={s.key}>
            {parts[s.key] !== undefined ? formatMs(parts[s.key]) : NONE}
          </Cell>
        ))}
      </dl>
      {total > 0 && (
        <div className="vox-bar" role="img" aria-label={`Parts of the time to first audio: ${cells.map(s => `${s.label} ${formatMs(parts[s.key])}`).join(', ')}`}>
          {cells.map(s => (
            <span key={s.key} className={`vox-bar__part vox-swatch--${s.key}`} style={{ flexGrow: Math.max(1, parts[s.key] ?? 0) }} />
          ))}
        </div>
      )}
    </section>
  )
}
