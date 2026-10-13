import type { PackageFacts, Rows, RunWindow, Verdict } from '../../shared/types'
import { checkRows, shownList, summarize, summaryText, type Figure, type PackageResult } from '../lib/labels'

interface FigureCheckProps {
  window: RunWindow
  packages: PackageResult[]
  facts: PackageFacts[]
  figures: Figure[]
  rowsByName: Record<string, Rows>
}

const BADGE: Record<Verdict, { cls: string; word: string }> = {
  checked: { cls: 'ds-badge ds-badge--success', word: 'checked' },
  wrong: { cls: 'ds-badge ds-badge--danger', word: 'wrong' },
  unchecked: { cls: 'ds-badge ds-badge--warning', word: 'unchecked' },
  neutral: { cls: 'ds-badge', word: 'date' },
}

/**
 * The check on every figure, below the explanation region, where digits are allowed: the summary, how many package
 * explanations arrived, and one row per claim with the model's value, npm's value and how to check it by hand.
 */
export default function FigureCheck({ window, packages, facts, figures, rowsByName }: FigureCheckProps) {
  const shown = shownList(packages)
  const rows = checkRows(shown, figures, { window, facts }, rowsByName)
  return (
    <section className="figure-check ds-card" aria-labelledby="figure-check-title">
      <h2 id="figure-check-title" className="ds-section__title">
        Figure check
      </h2>
      <p className="figure-check__summary">{summaryText(summarize(shown))}</p>
      <p className="ds-hint">
        {shown.length} of {packages.length} package explanations shown
      </p>
      {rows.length > 0 && (
        <details className="figure-check__rows">
          <summary>Show every figure ({rows.length})</summary>
          <div className="ds-scroll-x">
            <table className="data-table ledger">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Text</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Package</th>
                  <th scope="col">Span or day</th>
                  <th scope="col">Model value</th>
                  <th scope="col">npm value</th>
                  <th scope="col">How to check</th>
                  <th scope="col">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.key}>
                    <td className="fc-n ds-num">{row.number === null ? '' : <a href={`#fig-${row.number}`}>{row.number}</a>}</td>
                    <td className="fc-text">{row.text}</td>
                    <td className="fc-kind" data-label="Kind">{row.kind}</td>
                    <td className="fc-pkg" data-label="Package">{row.pkg}</td>
                    <td className="fc-where" data-label="Span or day">{row.where}</td>
                    <td className="fc-model ds-num" data-label="Model value">{row.modelValue}</td>
                    <td className="fc-npm ds-num" data-label="npm value">{row.npmValue}</td>
                    <td className="fc-how" data-label="How to check">{row.howTo}</td>
                    <td className="fc-verdict">
                      <span className={BADGE[row.verdict].cls}>{BADGE[row.verdict].word}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  )
}
