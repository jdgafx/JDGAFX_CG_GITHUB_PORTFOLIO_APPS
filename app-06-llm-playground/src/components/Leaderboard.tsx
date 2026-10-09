import { ELO_K, ELO_START, FEW_VOTES, type Confidence, type LeaderboardResponse, type LeaderboardRow, type RatingChange } from '../../netlify/shared/contract'
import type { BoardState } from '../lib/useArena'
import { formatDelta, formatRating, splitModel } from '../lib/format'

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
        <h2 className="ds-section__title" id="board-title">Leaderboard</h2>
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

function Table({ board, changes }: { board: LeaderboardResponse; changes: RatingChange[] }) {
  const ratings = board.rows.map(r => r.rating)
  const lo = Math.min(ELO_START, ...ratings) - 40
  const hi = Math.max(ELO_START, ...ratings) + 40
  const at = (rating: number) => `${((rating - lo) / (hi - lo)) * 100}%`
  const moved = new Map(changes.map(c => [c.model, c.after - c.before]))
  const noRatingMoved = board.rows.length > 0 && board.rows.every(r => r.rating === ELO_START)
  return (
    <>
      <div className="ds-stage arena-board">
        <ol className="arena-rows" aria-label="Models ranked by rating">
          {board.rows.map(row => (
            <Row key={row.model} row={row} at={at} baseline={at(ELO_START)} delta={moved.get(row.model) ?? null} />
          ))}
        </ol>
      </div>
      <p className="ds-help arena-board__foot">
        {board.ballots.toLocaleString('en-US')} {board.ballots === 1 ? 'vote' : 'votes'} counted
        {board.ties > 0 ? `, ${board.ties.toLocaleString('en-US')} ${board.ties === 1 ? 'tie' : 'ties'}` : ''}
        {board.allBad > 0 ? `, ${board.allBad.toLocaleString('en-US')} marked all bad` : ''}
        {board.updatedAt ? `. Last vote ${new Date(board.updatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
        . Standard Elo with K = {ELO_K}: picking one answer of three beats the other two. Ties draw every pair. Ratings from
        fewer than {FEW_VOTES} votes are marked and should not be read as a ranking.
        {noRatingMoved ? ' Every rating is still at the start because every vote so far was a tie or all bad.' : ''}
      </p>
      <StorageNote board={board} />
    </>
  )
}

function Row({ row, at, baseline, delta }: { row: LeaderboardRow; at: (rating: number) => string; baseline: string; delta: number | null }) {
  const { vendor, name } = splitModel(row.model)
  const conf = CONFIDENCE[row.confidence]
  return (
    <li className={`arena-row arena-row--${row.confidence}${delta !== null ? ' arena-row--moved' : ''}`}>
      <span className="arena-rank" aria-label={`Rank ${row.rank}`}>{row.rank}</span>
      <div className="arena-row__who" title={row.model}>
        <span className="arena-row__name">{name}</span>
        <span className="arena-row__vendor">{vendor}</span>
      </div>
      <div className="arena-row__rating">
        <span className="arena-rating">{formatRating(row.rating)}</span>
        {delta !== null && (
          <span className={delta >= 0 ? 'arena-delta arena-delta--up' : 'arena-delta arena-delta--down'}>
            {formatDelta(delta)}
          </span>
        )}
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
      <span className={`ds-badge arena-conf arena-conf--${row.confidence}`} title={conf.hint}>
        {conf.label}
      </span>
    </li>
  )
}
