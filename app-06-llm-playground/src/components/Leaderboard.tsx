import { ELO_K, ELO_START, FEW_VOTES, type Confidence, type LeaderboardResponse, type LeaderboardRow, type RatingChange } from '../../netlify/shared/contract'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { rankShifts, sharedConfidence } from '../lib/board'
import type { BoardState } from '../lib/useArena'
import { formatRating, splitModel } from '../lib/format'
import { Delta } from './Delta'

const CONFIDENCE: Record<Confidence, { label: string; hint: string }> = {
  few: { label: 'Few votes', hint: `Fewer than ${FEW_VOTES} votes: too early to trust this rank` },
  provisional: { label: 'Provisional', hint: 'Still moving with each vote' },
  steady: { label: 'Steady', hint: 'Enough votes for the rating to settle' },
}

interface LeaderboardProps {
  state: BoardState
  // The rating changes from the vote just cast, shown on the rows they moved.
  changes: RatingChange[]
  onRetry: () => void
}

export function Leaderboard({ state, changes, onRetry }: LeaderboardProps) {
  return (
    <section className="ds-section ds-run__stage" aria-labelledby="board-title">
      <div className="ds-section__head ds-section__head--row">
        <h2 className="ds-section__title" id="board-title" tabIndex={-1} data-reveal-focus>Leaderboard</h2>
        <p className="ds-section__sub">
          Elo ratings from every visitor's blind votes. Each model starts at {ELO_START.toLocaleString('en-US')}.
        </p>
      </div>
      <BoardBody state={state} changes={changes} onRetry={onRetry} />
    </section>
  )
}

function BoardBody({ state, changes, onRetry }: LeaderboardProps) {
  if (state.state === 'loading') {
    return (
      <div className="ds-state ds-state--loading" aria-busy="true">
        <span className="ds-state__mark" aria-hidden="true" />
        <p className="ds-state__title">Loading the leaderboard</p>
        <div className="ds-skeleton" aria-hidden="true"><span /><span /><span /></div>
      </div>
    )
  }
  if (state.state === 'error') {
    return (
      <div className="ds-state ds-state--error" role="alert">
        <span className="ds-state__mark" aria-hidden="true" />
        <p className="ds-state__title">The leaderboard could not be loaded</p>
        <p className="ds-state__body">{state.message}</p>
        <div className="ds-state__actions">
          <button type="button" className="ds-button" onClick={onRetry}>Try again</button>
        </div>
      </div>
    )
  }
  const { board } = state
  if (board.rows.length === 0 && board.ballots === 0) {
    return (
      <>
        <div className="ds-state ds-state--empty">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">No votes yet</p>
          <p className="ds-state__body">
            The board fills only from real votes, and nobody has voted. Run a blind comparison and pick the best answer to
            put the first models on it.
          </p>
        </div>
        <StorageNote board={board} />
      </>
    )
  }
  return <Table board={board} changes={changes} />
}

function StorageNote({ board }: { board: LeaderboardResponse }) {
  if (board.storage !== 'memory') return null
  return (
    <p className="ds-notice ds-notice--warning">
      Votes are kept in this server's memory because Netlify Blobs is not configured here. They reset when it restarts.
    </p>
  )
}

const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Rows glide from their old place to their new one when a vote reorders the board (FLIP), unless motion is reduced.
function useReorder(list: RefObject<HTMLOListElement | null>, key: string) {
  const rects = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>('[data-model]') ?? [])]
    const next = new Map(rows.map(r => [r.dataset.model ?? '', r.getBoundingClientRect().top]))
    if (!calm()) {
      for (const row of rows) {
        const was = rects.current.get(row.dataset.model ?? '')
        const dy = was === undefined ? 0 : was - (next.get(row.dataset.model ?? '') ?? 0)
        if (Math.abs(dy) < 2) continue
        row.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' })
      }
    }
    rects.current = next
  }, [list, key])
}

// The rating counts from its old value to the new one, once. The caller keys it by the change, so each vote starts it afresh.
function Rating({ value, from }: { value: number; from: number | null }) {
  const animate = from !== null && !calm()
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!animate) return
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 650)
      setT(1 - (1 - progress) ** 3)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [animate])
  const shown = animate && from !== null ? from + (value - from) * t : value
  return <span className="arena-rating">{formatRating(shown)}</span>
}

function Table({ board, changes }: { board: LeaderboardResponse; changes: RatingChange[] }) {
  const list = useRef<HTMLOListElement>(null)
  useReorder(list, board.rows.map(r => r.model).join('|'))
  const ratings = board.rows.map(r => r.rating)
  const lo = Math.min(ELO_START, ...ratings) - 40
  const hi = Math.max(ELO_START, ...ratings) + 40
  const at = (rating: number) => `${((rating - lo) / (hi - lo)) * 100}%`
  const moved = new Map(changes.map(c => [c.model, c]))
  const shifts = rankShifts(board.rows, changes)
  const shared = sharedConfidence(board.rows)
  const noRatingMoved = board.rows.length > 0 && board.rows.every(r => r.rating === ELO_START)
  return (
    <>
      <div className="arena-board">
        <p className="arena-legend">
          <i className="arena-meter__base arena-legend__tick" aria-hidden="true" /> Marks the {ELO_START.toLocaleString('en-US')} starting rating
        </p>
        <ol className="arena-rows" aria-label="Models ranked by rating" ref={list}>
          {board.rows.map(row => (
            <Row key={row.model} row={row} at={at} baseline={at(ELO_START)} change={moved.get(row.model) ?? null} shift={shifts.get(row.model) ?? 0} pill={shared === null} />
          ))}
        </ol>
      </div>
      <p className="ds-help arena-board__foot">
        {board.ballots.toLocaleString('en-US')} {board.ballots === 1 ? 'vote' : 'votes'} counted
        {board.ties > 0 ? `, ${board.ties.toLocaleString('en-US')} ${board.ties === 1 ? 'tie' : 'ties'}` : ''}
        {board.allBad > 0 ? `, ${board.allBad.toLocaleString('en-US')} marked all bad` : ''}
        {board.updatedAt ? `. Last vote ${new Date(board.updatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
        . Standard Elo with K = {ELO_K}: picking one answer of three beats the other two. Ties draw every pair.
        {shared ? ` Every rating here is ${CONFIDENCE[shared].label.toLowerCase()}: ${CONFIDENCE[shared].hint.toLowerCase()}.` : ` Ratings from fewer than ${FEW_VOTES} votes are marked and should not be read as a ranking.`}
        {noRatingMoved ? ' Every rating is still at the start because every vote so far was a tie or all bad.' : ''}
      </p>
      <StorageNote board={board} />
    </>
  )
}

function Row({ row, at, baseline, change, shift, pill }: { row: LeaderboardRow; at: (rating: number) => string; baseline: string; change: RatingChange | null; shift: number; pill: boolean }) {
  const { vendor, name } = splitModel(row.model)
  const conf = CONFIDENCE[row.confidence]
  const delta = change ? change.after - change.before : null
  return (
    <li className={`arena-row arena-row--${row.confidence}${change ? ' arena-row--moved' : ''}`} data-model={row.model}>
      <span className="arena-rank" aria-label={`Rank ${row.rank}`}>{row.rank}</span>
      {shift !== 0 && (
        <span className="arena-shift" aria-label={`${shift > 0 ? 'up' : 'down'} ${Math.abs(shift)} place${Math.abs(shift) === 1 ? '' : 's'}`}>
          {shift > 0 ? '\u25B2' : '\u25BC'}{Math.abs(shift)}
        </span>
      )}
      <div className="arena-row__who" title={row.model}>
        <span className="arena-row__name">{name}</span>
        <span className="arena-row__vendor">{vendor}</span>
      </div>
      <div className="arena-row__rating">
        <Rating key={`${change?.before}-${row.rating}`} value={row.rating} from={change ? change.before : null} />
        {delta !== null && <Delta delta={delta} />}
      </div>
      <div className="arena-meter" aria-hidden="true">
        <span className="arena-meter__fill" style={{ width: at(row.rating) }} />
        <i className="arena-meter__base" style={{ left: baseline }} />
      </div>
      <dl className="arena-record">
        <div><dt>Won</dt><dd>{row.wins}</dd></div>
        <div><dt>Lost</dt><dd>{row.losses}</dd></div>
        <div><dt>Tied</dt><dd>{row.ties}</dd></div>
        <div><dt>Votes</dt><dd>{row.votes}</dd></div>
      </dl>
      {pill && (
        <span className={`ds-badge arena-conf arena-conf--${row.confidence}`} title={conf.hint}>
          {conf.label}
        </span>
      )}
    </li>
  )
}
