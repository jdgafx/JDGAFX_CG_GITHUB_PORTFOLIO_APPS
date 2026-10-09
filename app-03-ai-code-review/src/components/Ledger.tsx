import { VERDICT_ORDER, VERDICT_WORD, type VerdictCounts } from '../lib/verdicts'

/**
 * The first pass at a glance: one segment per comment, grouped by what became of it, with the count written under each
 * group. The sentence above it is the announcement for screen readers, so the bar is hidden from them.
 */
export function Ledger({ counts }: { counts: VerdictCounts }) {
  const total = VERDICT_ORDER.reduce((sum, v) => sum + counts[v], 0)
  const groups = VERDICT_ORDER.filter((v) => counts[v] > 0)
  return (
    <div className="ledger" aria-hidden="true">
      <div className="ledger__groups">
        {groups.map((v) => (
          <div key={v} className="ledger__group" style={{ flexGrow: counts[v] }}>
            <div className="ledger__bar">
              {Array.from({ length: counts[v] }, (_, i) => (
                <span key={i} className={`ledger__seg ledger__seg--${v}`} />
              ))}
            </div>
            <span className="ledger__label">{`${counts[v]} ${VERDICT_WORD[v].word.toLowerCase()}`}</span>
          </div>
        ))}
      </div>
      <span className="ledger__total">{`${total} from pass 1`}</span>
    </div>
  )
}
