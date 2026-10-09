import { VERDICT_ORDER, VERDICT_WORD, type VerdictCounts } from '../lib/verdicts'

/**
 * The first pass at a glance: one segment per comment, in order, coloured and patterned by what became of it.
 * The chips below carry the counts in words, so the bar is decoration for the eye and hidden from screen readers.
 */
export function Ledger({ counts }: { counts: VerdictCounts }) {
  const total = VERDICT_ORDER.reduce((sum, v) => sum + counts[v], 0)
  return (
    <div className="ledger">
      <div className="ledger__bar" aria-hidden="true">
        {VERDICT_ORDER.flatMap((v) =>
          Array.from({ length: counts[v] }, (_, i) => <span key={`${v}-${i}`} className={`ledger__seg ledger__seg--${v}`} />),
        )}
      </div>
      <div className="ds-chips ledger__chips">
        {VERDICT_ORDER.filter((v) => v !== 'unverified' || counts[v] > 0).map((v) => (
          <span key={v} className={VERDICT_WORD[v].chip}>
            {`${counts[v]} ${VERDICT_WORD[v].word.toLowerCase()}`}
          </span>
        ))}
        <span className="ds-chip ds-chip--muted">{`${total} from pass 1`}</span>
      </div>
    </div>
  )
}
