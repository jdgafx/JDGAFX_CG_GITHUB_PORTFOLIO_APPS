import { useEffect, useMemo, useRef, useState } from 'react'
import { frameTotals, followIndex, moveIndex, nextPlayable, playableCount, type ReplayItem } from '../lib/replay'
import type { Phase } from '../lib/runState'
import type { PlanStatus } from '../lib/trace'
import { formatBytes } from '../lib/format'
import { Md } from './Md'

const PLAY_MS = 1_500

const WORD: Record<PlanStatus, string> = { waiting: 'Waiting', running: 'Running', ok: 'Done', failed: 'Failed', skipped: 'Not run' }
const DOT: Record<PlanStatus, string> = {
  waiting: 'ds-dot',
  running: 'ds-dot ds-dot--running',
  ok: 'ds-dot ds-dot--ok',
  failed: 'ds-dot ds-dot--failed',
  skipped: 'ds-dot ds-dot--skipped',
}

/** Why there is no picture for a step, in words for the person looking at the empty frame. */
function emptyFrameText(item: ReplayItem): string {
  if (item.note) return item.note
  if (item.status === 'running') return 'The step is running. Its picture appears when the step ends.'
  if (item.status === 'waiting') return 'This step waits for the steps before it.'
  if (item.status === 'skipped') return 'This step did not run, so there is no picture.'
  return 'No picture was captured for this step.'
}

function Picture({ item }: { item: ReplayItem }) {
  const title = item.observed?.title || item.observed?.url || item.label
  return (
    <div className={`ds-frame bb-shot${item.status === 'failed' ? ' bb-shot--failed' : ''}`} style={item.frame ? { aspectRatio: `${item.frame.width} / ${item.frame.height}` } : undefined}>
      {item.frame ? (
        <img src={`data:image/jpeg;base64,${item.frame.data}`} width={item.frame.width} height={item.frame.height} alt={`The page after step ${item.index + 1}, ${title}`} />
      ) : (
        <p className="bb-shot__empty">{emptyFrameText(item)}</p>
      )}
      {item.status === 'failed' && item.frame && <span className="bb-shot__tag">Page when step {item.index + 1} failed</span>}
    </div>
  )
}

function Detail({ item, expectation }: { item: ReplayItem; expectation: string | null }) {
  const observed = item.observed
  return (
    <div className="bb-detail">
      <div className="bb-detail__head">
        <span className="bb-detail__step">Step {item.index + 1}</span>
        <span className={`ds-badge ${item.status === 'ok' ? 'ds-badge--success' : item.status === 'failed' ? 'ds-badge--danger' : item.status === 'running' ? 'ds-badge--accent' : ''}`.trim()}>
          <span className={DOT[item.status]} aria-hidden="true" />
          {WORD[item.status]}
        </span>
      </div>
      <p className="bb-detail__label">{item.label}</p>
      <dl className="ds-kv bb-kv">
        <dt>Plan</dt>
        <dd className="bb-prose"><Md text={item.thought} /></dd>
        <dt>Browser</dt>
        <dd className="bb-prose">{item.detail}</dd>
        <dt>Address</dt>
        <dd>{observed?.url ?? '—'}</dd>
        <dt>Title</dt>
        <dd className="bb-prose">{observed ? observed.title || 'Untitled page' : '—'}</dd>
      </dl>
      {observed ? (
        <div className="bb-text">
          <p className="bb-text__label">{observed.region ? <>Text of <code>{observed.region}</code>, first 10 matches</> : 'Page text read after this step'}</p>
          {/* The text can be longer than its box, so the box takes focus and a keyboard user can scroll it. */}
          <pre className="bb-pre" role="region" aria-label={`Text read after step ${item.index + 1}`} tabIndex={0}>{observed.excerpt || 'The page returned no readable text.'}</pre>
        </div>
      ) : null}
      {expectation && item.status === 'ok' && observed ? <p className="ds-help">Plan expected: {expectation}. BrowseBot shows what the browser observed and does not judge whether it answers the task.</p> : null}
    </div>
  )
}

interface ReplayProps {
  items: ReplayItem[]
  phase: Phase
  runId: number
  expectation: string | null
  sessionId: string | null
}

/**
 * The visual replay: one picture per step in a filmstrip, the chosen step large beside the address, title and
 * text the browser read at that moment. Arrow keys move between steps, and play steps through a finished run.
 */
export default function Replay({ items, phase, runId, expectation, sessionId }: ReplayProps) {
  const [chosen, setChosen] = useState<{ runId: number; index: number } | null>(null)
  const [playFor, setPlayFor] = useState<number | null>(null)
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const strip = useRef<HTMLDivElement>(null)
  const live = phase === 'running' || phase === 'planning'
  const mine = chosen && chosen.runId === runId ? chosen.index : null
  const current = Math.min(mine ?? followIndex(items, phase), items.length - 1)
  const item = items[current]
  const totals = useMemo(() => frameTotals(items), [items])
  const playable = playableCount(items)
  const canPlay = !live && playable >= 2
  // A new run ends play: while the run is live nothing plays.
  const playing = playFor === runId && !live

  const choose = (index: number) => setChosen({ runId, index })

  // Play steps forward on a timer and stops at the last step that ran.
  useEffect(() => {
    if (!playing) return
    const id = window.setTimeout(() => {
      const next = nextPlayable(items, current)
      if (next === null) setPlayFor(null)
      else setChosen({ runId, index: next })
    }, PLAY_MS)
    return () => window.clearTimeout(id)
  }, [playing, current, items, runId])

  // Keep the chosen thumbnail in view inside the strip, without moving the page.
  useEffect(() => {
    const tab = tabs.current[current]
    const box = strip.current
    if (!tab || !box) return
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const left = tab.offsetLeft - (box.clientWidth - tab.offsetWidth) / 2
    box.scrollTo({ left: Math.max(0, left), behavior: calm ? 'auto' : 'smooth' })
  }, [current, items.length])

  if (items.length === 0 || !item) return null

  const onKey = (event: React.KeyboardEvent) => {
    const next = moveIndex(current, event.key, items.length)
    if (next === null) return
    event.preventDefault()
    setPlayFor(null)
    choose(next)
    tabs.current[next]?.focus({ preventScroll: true })
  }
  const onPlay = () => {
    if (playing) return setPlayFor(null)
    if (nextPlayable(items, current) === null) choose(items.findIndex((i) => i.status === 'ok' || i.status === 'failed'))
    setPlayFor(runId)
  }

  return (
    <div className="bb-replay">
      <div className="bb-viewer">
        <div className="bb-viewer__shot">
          <Picture item={item} />
        <div className="bb-transport">
          <button type="button" className="ds-button" disabled={!canPlay} aria-pressed={playing} onClick={onPlay} title={canPlay ? 'Steps through the pictures one by one.' : 'Play is available when a finished run has at least two pictures.'}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              {playing ? <><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></> : <polygon points="6 3 20 12 6 21 6 3" />}
            </svg>
            {playing ? 'Pause' : 'Play replay'}
          </button>
          <input
            className="bb-scrub"
            type="range"
            min={1}
            max={items.length}
            value={current + 1}
            aria-label="Scrub through the steps"
            aria-valuetext={`Step ${current + 1} of ${items.length}: ${item.label}`}
            disabled={items.length < 2}
            onChange={(event) => {
              setPlayFor(null)
              choose(Number(event.target.value) - 1)
            }}
          />
          <span className="bb-transport__count ds-mono">{current + 1} / {items.length}</span>
          {live && mine !== null ? (
            <button type="button" className="ds-button" onClick={() => setChosen(null)} title="Goes back to the step the browser is on now.">Follow live step</button>
          ) : null}
        </div>

        <div className="bb-strip" ref={strip}>
          <div role="tablist" aria-label="Steps, one picture each" className="bb-film" onKeyDown={onKey}>
            {items.map((it, i) => (
              <button
                key={it.index}
                ref={(node) => { tabs.current[i] = node }}
                id={`step-tab-${i}`}
                type="button"
                role="tab"
                aria-selected={i === current}
                aria-controls="replay-panel"
                tabIndex={i === current ? 0 : -1}
                className={`bb-cell bb-cell--${it.status}`}
                onClick={() => {
                  setPlayFor(null)
                  choose(i)
                }}
              >
                <span className="bb-cell__pic">
                  {it.frame ? <img src={`data:image/jpeg;base64,${it.frame.data}`} alt="" /> : <span className="bb-cell__none">{it.status === 'failed' ? '!' : ''}</span>}
                </span>
                <span className="bb-cell__label"><span className="ds-mono">{i + 1}</span> {it.label}</span>
                <span className="bb-cell__status"><span className={DOT[it.status]} aria-hidden="true" />{WORD[it.status]}</span>
              </button>
            ))}
          </div>
        </div>
        </div>
        <div id="replay-panel" role="tabpanel" aria-labelledby={`step-tab-${current}`} className="bb-viewer__detail">
          <Detail item={item} expectation={current === items.length - 1 ? expectation : null} />
        </div>
      </div>

      <p className="ds-help">
        Left and right arrow keys move between steps. {totals.count === 0 ? 'No pictures yet.' : `${totals.count} ${totals.count === 1 ? 'picture' : 'pictures'}, ${formatBytes(totals.bytes)} in all.`}
        {sessionId ? <> Browserbase session <span className="ds-mono">{sessionId}</span>.</> : ' No browser session yet.'}
      </p>
    </div>
  )
}
