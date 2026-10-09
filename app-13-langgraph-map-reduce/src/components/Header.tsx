import { PHASE_WORD, phaseDot, phaseTone } from '../lib/status'
import type { Phase } from '../lib/view'

export function Header({ phase }: { phase: Phase }) {
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div className="ds-brand">
          <div className="ds-brand__row">
            <span className="ds-plate" role="img" aria-label="App 13">
              13
            </span>
            <h1 className="ds-title">GraphSwarm</h1>
            <span className={`ds-badge ${phaseTone(phase)}`}>
              <span className={phaseDot(phase)} aria-hidden="true" />
              {PHASE_WORD[phase]}
            </span>
          </div>
          <p className="ds-subtitle">
            Load a Wikipedia article or paste a long document. Get a cited summary, then open any point to read the sentences behind it.
          </p>
        </div>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> a LangGraph map-reduce: many parallel extractions, one synthesis that cites its
          chunks, and a coverage check that re-runs only what was missed. The coverage map shows what each chunk contributed.
        </p>
      </div>
    </header>
  )
}
