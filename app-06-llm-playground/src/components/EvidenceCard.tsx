import { COMPARE_MAX_TOKENS, type CompareResponse } from '../../netlify/shared/contract'
import { formatCost, formatCount, formatMs, tokensPerSecond } from '../lib/format'
import { panelStatus, verdictSentences } from '../lib/run'

export function EvidenceCard({ compare }: { compare: CompareResponse | null }) {
  return (
    <section className="ds-card" aria-labelledby="evidence-title">
      <div className="ds-card__head">
        <h2 className="ds-card__title" id="evidence-title">Evidence</h2>
        <span className="ds-hint">Measured per panel</span>
      </div>
      {!compare ? (
        <div className="ds-empty">Measured numbers for each panel appear here after a run.</div>
      ) : (
        <>
          <div className="arena-table-wrap">
            <table className="arena-table">
              <caption className="sr-only">Measured results for each panel</caption>
              <thead>
                <tr>
                  <th scope="col">Panel</th>
                  <th scope="col">Served model</th>
                  <th scope="col">Status</th>
                  <th scope="col">Latency</th>
                  <th scope="col">Prompt tokens</th>
                  <th scope="col">Output tokens</th>
                  <th scope="col">Reasoning tokens</th>
                  <th scope="col">Tokens per second</th>
                  <th scope="col">Cost</th>
                </tr>
              </thead>
              <tbody>
                {compare.panels.map(panel => (
                  <tr key={panel.slot}>
                    <th scope="row" data-label="Panel">Panel {panel.slot}</th>
                    <td data-label="Served model">{panel.servedModel ?? 'not reported'}</td>
                    <td data-label="Status">{panelStatus(panel).label}</td>
                    <td className="arena-num" data-label="Latency">{formatMs(panel.latencyMs)}</td>
                    <td className="arena-num" data-label="Prompt tokens">{formatCount(panel.usage.prompt_tokens)}</td>
                    <td className="arena-num" data-label="Output tokens">{formatCount(panel.usage.completion_tokens)}</td>
                    <td className="arena-num" data-label="Reasoning tokens">{formatCount(panel.usage.reasoning_tokens)}</td>
                    <td className="arena-num" data-label="Tokens per second">
                      {tokensPerSecond(panel.usage.completion_tokens, panel.latencyMs)}
                    </td>
                    <td className="arena-num" data-label="Cost">{formatCost(panel.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="arena-verdicts">
            {verdictSentences(compare.summary).map(sentence => (
              <p key={sentence}>{sentence}</p>
            ))}
          </div>
          <p className="ds-hint">
            One prompt, one sample. This is a comparison, not a benchmark. Output capped at {COMPARE_MAX_TOKENS} tokens per model.
          </p>
        </>
      )}
    </section>
  )
}
