import { formatCount, formatMs, formatUsd, type TraceLine } from '../lib/run'

interface RunTraceProps {
  lines: TraceLine[]
}

export default function RunTrace({ lines }: RunTraceProps) {
  if (lines.length === 0) {
    return <div className="ds-empty">Each stage call appears here when it finishes.</div>
  }

  return (
    <ol className="ds-trace" aria-label="Run trace">
      {lines.map(line => (
        <li key={line.key} className="ds-trace__step">
          <span className="ds-trace__index">{line.index}</span>
          <div className="trace-body">
            <div className="ds-trace__name">{line.name}</div>
            <div className="ds-trace__detail">{line.detail}</div>
            {line.share > 0 && (
              <div className="ds-trace__bar" style={{ width: `${line.share}%` }} aria-hidden="true" />
            )}
          </div>
          <div className="ds-trace__meta">
            <div>{line.status}</div>
            {line.status !== 'skipped' && (
              <>
                <div>{formatMs(line.ms)}</div>
                <div>{line.tokens === undefined ? 'tokens not reported' : `${formatCount(line.tokens)} tokens`}</div>
                <div>{line.cost === undefined ? 'cost not reported' : formatUsd(line.cost)}</div>
                <div className="trace-model">{line.model ?? 'model not reported'}</div>
              </>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
