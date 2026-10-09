import type { ReactNode } from 'react'
import { COMPARE_MAX_TOKENS, SLOTS, type CompareResponse, type PanelResult } from '../../netlify/shared/contract'
import { formatCost, formatCount, formatMs, tokensPerSecond } from '../lib/format'
import { panelStatus, verdictSentences } from '../lib/run'

interface Measure {
  label: string
  className?: string
  cell: (panel: PanelResult) => ReactNode
}

// Measures run down the rows and panels across the columns, so each panel reads straight down its column.
const MEASURES: Measure[] = [
  {
    label: 'Served model',
    className: 'ds-mono',
    cell: p => (p.servedModel ? <span className="arena-id" title={p.servedModel}>{p.servedModel}</span> : 'not reported'),
  },
  {
    label: 'Status',
    cell: p => {
      const status = panelStatus(p)
      return (
        <span className="ds-badge">
          <span className={`ds-dot ${status.dot}`} aria-hidden="true" />
          {status.label}
        </span>
      )
    },
  },
  { label: 'Latency', className: 'ds-num', cell: p => formatMs(p.latencyMs) },
  { label: 'Prompt tokens', className: 'ds-num', cell: p => formatCount(p.usage.prompt_tokens) },
  { label: 'Output tokens', className: 'ds-num', cell: p => formatCount(p.usage.completion_tokens) },
  { label: 'Reasoning tokens', className: 'ds-num', cell: p => formatCount(p.usage.reasoning_tokens) },
  {
    label: 'Tokens per second',
    className: 'ds-num',
    cell: p => tokensPerSecond(p.usage.completion_tokens, p.latencyMs),
  },
  { label: 'Cost', className: 'ds-num', cell: p => formatCost(p.cost) },
]

export function EvidenceCard({ compare }: { compare: CompareResponse | null }) {
  return (
    <section className="ds-section" aria-labelledby="evidence-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 className="ds-section__title" id="evidence-title">
          Evidence
        </h2>
        <p className="ds-section__sub">Measured results only. Ties go to the earlier panel.</p>
      </div>
      {!compare ? (
        <div className="ds-empty">Measured numbers for each panel appear here after a run.</div>
      ) : (
        <>
          <ul className="arena-verdicts">
            {verdictSentences(compare.summary).map(sentence => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
          <div className="ds-scroll-x">
            <table className="arena-table">
              <caption className="ds-sr-only">Measured results for each panel</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="ds-sr-only">Measure</span>
                  </th>
                  {SLOTS.map(slot => (
                    <th scope="col" key={slot}>
                      Panel {slot}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MEASURES.map(measure => (
                  <tr key={measure.label}>
                    <th scope="row">{measure.label}</th>
                    {SLOTS.map(slot => {
                      const panel = compare.panels.find(p => p.slot === slot)
                      return (
                        <td key={slot} className={measure.className} data-panel={`Panel ${slot}`}>
                          {panel ? measure.cell(panel) : 'not reported'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ds-help">
            One prompt, one sample. This is a comparison, not a benchmark. Output capped at{' '}
            {COMPARE_MAX_TOKENS.toLocaleString('en-US')} tokens per model.
          </p>
        </>
      )}
    </section>
  )
}
