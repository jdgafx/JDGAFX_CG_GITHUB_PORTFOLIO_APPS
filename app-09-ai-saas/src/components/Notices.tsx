import type { Snapshot } from '../lib/useRun'

/** What the data did not give: failed packages, a missing release history, no-data days and possible npm gaps. */
export default function Notices({ view }: { view: Snapshot }) {
  const { window } = view
  const noData = window ? window.noData.filter(d => d >= window.start && d <= window.L) : []
  const gaps = view.facts.flatMap(f => f.possibleGaps.map(d => `${f.name} ${d}`))
  const releaseFailed = Object.entries(view.releaseState).filter(([, s]) => s === 'failed').map(([n]) => n)
  return (
    <div className="notices ds-stack">
      {view.error && (
        <p className="ds-notice ds-notice--error" role="alert">
          {view.error}
        </p>
      )}
      {view.failedNames.length > 0 && (
        <p className="ds-notice ds-notice--warning">
          npm did not return downloads for {view.failedNames.join(', ')}. The other packages are shown.
        </p>
      )}
      {releaseFailed.length > 0 && (
        <p className="ds-notice ds-notice--warning">
          The release history could not be loaded for {releaseFailed.join(', ')}, so release columns read unavailable.
        </p>
      )}
      {noData.length > 0 && (
        <p className="ds-notice">
          npm reports no downloads for any selected package on {noData.join(', ')}. Those days are shaded and left out.
        </p>
      )}
      {gaps.length > 0 && (
        <p className="ds-notice">
          Possible npm gaps (no downloads for one package while another had some): {gaps.join(', ')}. They are hollow markers on the charts and are not counted as drops.
        </p>
      )}
    </div>
  )
}
