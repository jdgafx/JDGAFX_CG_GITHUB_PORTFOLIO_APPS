import { useEffect, useMemo, useRef, useState } from 'react'
import { formatBytes } from '../lib/format'
import { frameTotals, followIndex, moveIndex, nextPlayable, playableCount, type ReplayItem } from '../lib/replay'
import type { Phase } from '../lib/runState'
import type { PlanStatus } from '../lib/trace'
import { nearestScroll, offsetInScroller, useEdges } from '../lib/useOverflow'
import BrowserFrame from './BrowserFrame'
import { Md } from './Md'

const PLAY_MS = 1_500
const NO_MATCH = 'The selector matched nothing, so this is the whole page text.'

const WORD: Record<PlanStatus, string> = { waiting: 'Waiting', running: 'Running', ok: 'Done', failed: 'Failed', skipped: 'Not run' }
const DOT: Record<PlanStatus, string> = {
  waiting: 'ds-dot',
  running: 'ds-dot ds-dot--running',
  ok: 'ds-dot ds-dot--ok',
  failed: 'ds-dot ds-dot--failed',
  skipped: 'ds-dot ds-dot--skipped',
}

/** True when an extract or verify step asked for a region and the browser fell back to the whole page. */
function fellBack(item: ReplayItem): boolean {
  return /Nothing matched/.test(item.detail)
}

/** What the browser read after the step, in a box that scrolls and fades where there is more. */
function ReadBox({ item }: { item: ReplayItem }) {
  const box = useRef<HTMLPreElement>(null)
  const edges = useEdges(box, 'y')
  const observed = item.observed
  if (!observed) return null
  return (
    <div className="bb-text">
      <p className="bb-text__label">
        What the browser read{observed.region ? <> from <code>{observed.region}</code></> : null}
      </p>
      {fellBack(item) ? <p className="bb-warn" role="note">{NO_MATCH}</p> : null}
      <div className={`bb-fade${edges.end ? ' bb-fade--end' : ''}`}>
        {/* The text can be longer than its box, so the box takes focus and a keyboard user can scroll it. */}
        <pre ref={box} className="bb-pre" role="region" aria-label={`Text read after step ${item.index + 1}`} tabIndex={0}>
          {observed.excerpt || 'The page returned no readable text.'}
        </pre>
      </div>
    </div>
  )
}

function Detail({ item }: { item: ReplayItem }) {
  const tone = item.status === 'ok' ? 'ds-badge--success' : item.status === 'failed' ? 'ds-badge--danger' : item.status === 'running' ? 'ds-badge--accent' : ''
  return (
    <div className="bb-detail">
      <div className="bb-detail__head">
        <span className="bb-detail__step">Step {item.index + 1}</span>
        <span className={`ds-badge ${tone}`.trim()}>
          <span className={DOT[item.status]} aria-hidden="true" />
          {WORD[item.status]}
        </span>
      </div>
      <p className="bb-detail__label">{item.label}</p>
      <dl className="ds-kv bb-kv">
        <dt>Plan</dt>
        <dd className="bb-prose"><Md text={item.thought} /></dd>
        <dt>Browser</dt>
        <dd className="bb-prose">{item.detail.split(' Nothing matched')[0].split(' Read the text of')[0]}</dd>
      </dl>
      <ReadBox item={item} />
    </div>
  )
}

interface ReplayProps {
  items: ReplayItem[]
  phase: Phase
  runId: number
  sessionId: string | null
}

/**
 * The visual replay: the chosen step as a browser window with its picture, beside what the browser read. A filmstrip
 * under both shows every step. Arrow keys move between steps, and play steps through a finished run.
 */
export default function Replay({ items, phase, runId, sessionId }: ReplayProps) {
  const [chosen, setChosen] = useState<{ runId: number; index: number } | null>(null)
  const [playFor, setPlayFor] = useState<number | null>(null)
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const strip = useRef<HTMLDivElement>(null)
  const edges = useEdges(strip, 'x')
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

  // Bring the chosen cell into view with the least movement, inside the strip only, so the page never moves.
  useEffect(() => {
    const tab = tabs.current[current]
    const box = strip.current
    if (!tab || !box) return
    const left = offsetInScroller(tab.getBoundingClientRect().left, box.getBoundingClientRect().left, box.scrollLeft)
    const to = nearestScroll(box.scrollLeft, box.clientWidth, left, tab.offsetWidth)
    if (to === null) return
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    box.scrollTo({ left: to, behavior: calm ? 'auto' : 'smooth' })
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
  const count = <span className="bb-transport__count ds-mono">{current + 1} / {items.length}</span>

  return (
    <div className="bb-replay">
      <div className="bb-viewer">
        <div className="bb-viewer__shot">
          <BrowserFrame item={item} />
          {canPlay ? (
            <div className="bb-transport">
              <button type="button" className="ds-button" aria-pressed={playing} onClick={onPlay} title="Steps through the pictures one by one.">
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
                onChange={(event) => {
                  setPlayFor(null)
                  choose(Number(event.target.value) - 1)
                }}
              />
              {count}
            </div>
          ) : (
            <div className="bb-transport">
              {count}
              {live && mine !== null ? <button type="button" className="ds-button" onClick={() => {
                setChosen(null)
                // The button leaves with the click, so focus moves to the step the run is on.
                tabs.current[followIndex(items, phase)]?.focus({ preventScroll: true })
              }} title="Goes back to the step the browser is on now.">Follow live step</button> : null}
            </div>
          )}
        </div>
        <div id="replay-panel" role="tabpanel" aria-labelledby={`step-tab-${current}`} className="bb-viewer__detail">
          <Detail item={item} />
        </div>
      </div>

      <div className={`bb-strip${edges.start ? ' bb-strip--start' : ''}${edges.end ? ' bb-strip--end' : ''}`}>
        <div className="bb-strip__scroll" ref={strip}>
          <div role="tablist" aria-label="Steps, one picture each. Left and right arrow keys move between steps." className="bb-film" onKeyDown={onKey}>
            {items.map((it, i) => (
              <button
                key={it.index}
                ref={(node) => { tabs.current[i] = node }}
                id={`step-tab-${i}`}
                type="button"
                role="tab"
                title={it.label}
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
      <p className="ds-help">
        {totals.count === 0 ? 'No pictures yet.' : `${totals.count} ${totals.count === 1 ? 'picture' : 'pictures'}, ${formatBytes(totals.bytes)}.`}
        {sessionId ? <> Session <span className="ds-mono" title={sessionId}>{sessionId.slice(0, 8)}</span></> : ''}
      </p>
    </div>
  )
}
