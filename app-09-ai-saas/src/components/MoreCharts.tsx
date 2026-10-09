import type { PackageFigures } from '../../netlify/shared/contract'
import { AVERAGE_SPAN, averageRows, type DownloadWindow } from '../lib/analytics'
import { compact, seriesColor } from '../lib/format'
import LineChart from './LineChart'

interface MoreChartsProps {
  span: DownloadWindow
  packages: PackageFigures[]
  colorIndex: number[]
  log: boolean
}

/** The 7-day moving average, which removes the weekly cycle, and each package's share of the selection. */
export default function MoreCharts({ span, packages, colorIndex, log }: MoreChartsProps) {
  const ranked = [...packages.keys()].sort((a, b) => packages[b].total - packages[a].total)
  return (
    <section className="ds-section hub-more" aria-label="More charts">
      <LineChart
        title={`${AVERAGE_SPAN}-day moving average`}
        caption={`Each point averages the last ${AVERAGE_SPAN} days, which removes the weekly cycle. It starts on day ${AVERAGE_SPAN}.`}
        span={span}
        rows={averageRows(span)}
        colorIndex={colorIndex}
        log={log}
        height={240}
      />
      <figure className="ds-chart hub-share-chart">
        <figcaption className="ds-chart__head">
          <b>Share of downloads</b> <span className="ds-help">Each package's part of the selection's downloads over the window.</span>
        </figcaption>
        {packages.length < 2 ? (
          <p className="ds-help">Share compares packages. Add a second package to see it.</p>
        ) : (
          <>
            <div className="hub-stack" role="img" aria-label={`Share of downloads: ${packages.map((p) => `${p.name} ${p.sharePct}%`).join(', ')}`}>
              {ranked.map((i) => (
                <span key={packages[i].name} style={{ flexGrow: packages[i].total, background: seriesColor(colorIndex[i]) }} />
              ))}
            </div>
            <ul className="hub-share-list">
              {ranked.map((i) => (
                <li key={packages[i].name}>
                  <span className="hub-swatch" style={{ background: seriesColor(colorIndex[i]) }} aria-hidden="true" />
                  <span className="ds-mono hub-share-list__name">{packages[i].name}</span>
                  <span className="ds-num">{packages[i].sharePct}%</span>
                  <span className="ds-num ds-help">{compact(packages[i].total)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </figure>
    </section>
  )
}
