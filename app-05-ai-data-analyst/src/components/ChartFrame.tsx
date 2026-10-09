import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { measureWords } from '../lib/answer'
import { formatTick, limitGroups } from '../lib/chartGeometry'
import { downloadChartPng, downloadCsv, fileSlug } from '../lib/export'
import { labelFor, RAW_VOCABULARY, withUnit } from '../lib/vocabulary'
import type { AnalysisResult } from '../types'
import ChartSvg from './ChartSvg'

/** Above these counts the axis and legend stop being readable, so groups are collapsed. */
const MAX_BAR_GROUPS = 30
/** Eight categorical slots: seven groups and "Other". */
const MAX_PIE_SLICES = 8
/** On a phone, a chart with more groups than this scrolls sideways instead of crowding its labels. */
const WIDE_GROUPS = 8
const GROUP_MIN_PX = 30
const MIN_WIDTH = 280
/** A bar chart of more groups than this is drawn as horizontal bars, one row per group, which stay readable. */
const HBAR_FROM = 20

const exact = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 })

/** The width of an element, kept current as it resizes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    setWidth(Math.round(node.getBoundingClientRect().width))
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/** The chart on the v3 chart frame, with the values as a table and the result as CSV or PNG. */
export default function ChartFrame({ result }: { result: AnalysisResult }) {
  const [holder, available] = useWidth()
  const svgRef = useRef<SVGSVGElement | null>(null)
  const holdSvg = (element: SVGSVGElement | null) => {
    svgRef.current = element
  }
  // An export error belongs to the result it happened on, so a new result shows none.
  const [failure, setFailure] = useState<{ result: AnalysisResult; message: string } | null>(null)
  const { labels, datasets, queryPlan: plan } = result
  const vocab = result.vocab ?? RAW_VOCABULARY
  const values = datasets[0]?.values ?? []
  const chartType = plan.chartType
  const combinable = plan.aggregate.fn === 'sum' || plan.aggregate.fn === 'count'
  const unitOf = (text: string) => (plan.aggregate.fn === 'count' ? text : withUnit(vocab, plan.aggregate.field, text))

  if (labels.length === 0) {
    return (
      <div className="ds-state ds-state--empty" role="status">
        <span className="ds-state__mark" aria-hidden="true" />
        <p className="ds-state__title">Nothing to chart</p>
        <p className="ds-state__body">
          {result.having && result.having.total > 0
            ? 'No group met the threshold, so there is nothing to chart.'
            : 'No rows matched this query. Try loosening the filter in your question.'}
        </p>
      </div>
    )
  }

  const limited =
    chartType === 'pie'
      ? limitGroups(labels, values, MAX_PIE_SLICES, combinable)
      : chartType === 'bar'
        ? limitGroups(labels, values, MAX_BAR_GROUPS, combinable)
        : { labels, values, note: null }
  const wide = (chartType === 'bar' || chartType === 'line' || chartType === 'area') && limited.labels.length > WIDE_GROUPS
  const width = Math.max(MIN_WIDTH, wide ? Math.max(available, limited.labels.length * GROUP_MIN_PX + 80) : available)

  const measure = measureWords(plan, vocab)
  const horizontal = chartType === 'bar' && limited.labels.length > HBAR_FROM && limited.values.every((value) => value >= 0)
  const peak = Math.max(...limited.values, 0)
  const largest = limited.values.reduce((best, v, i) => (Math.abs(v) > Math.abs(limited.values[best] ?? 0) ? i : best), 0)
  const summary = `${chartType} chart. ${measure} by ${labelFor(vocab, plan.groupBy)}, across ${labels.length} groups. Largest: ${limited.labels[largest]} at ${unitOf(exact(limited.values[largest] ?? 0))}.`

  const savePng = () => {
    const svg = svgRef.current
    if (!svg) return
    setFailure(null)
    downloadChartPng(svg, {
      title: plan.title,
      subtitle: `${measure} by ${labelFor(vocab, plan.groupBy)}, ${result.dataset}`,
      filename: `${fileSlug(plan.title)}.png`,
    }).catch((error: unknown) =>
      setFailure({ result, message: error instanceof Error ? error.message : 'The image could not be saved.' }),
    )
  }

  return (
    <figure className="ds-chart app-chart">
      <div className="ds-chart__head">
        <b>{plan.title}</b>
        <span className="ds-help ds-num">
          {chartType} chart, {labels.length.toLocaleString()} {labels.length === 1 ? 'group' : 'groups'}
        </span>
      </div>
      <div
        ref={holder}
        className={wide && !horizontal ? 'app-chart__holder app-chart__holder--wide' : 'app-chart__holder'}
        {...(wide && !horizontal && width > available ? { tabIndex: 0, role: 'region', 'aria-label': 'Chart, scrolls sideways' } : {})}
      >
        {horizontal ? (
          <ul className="ds-hbar ds-hbar--scroll" role="list" tabIndex={0} aria-label={summary}>
            {limited.labels.map((label, index) => {
              const value = limited.values[index] ?? 0
              return (
                <li key={`${index}-${label}`} title={`${label}: ${unitOf(exact(value))}`}>
                  <span className="ds-hbar__label">{label}</span>
                  <span className="ds-hbar__track">
                    <span className="ds-hbar__bar" style={{ '--w': `${peak > 0 ? (value / peak) * 100 : 0}%` } as CSSProperties} />
                  </span>
                  <span className="ds-hbar__value">{formatTick(value)}</span>
                </li>
              )
            })}
          </ul>
        ) : (
          available > 0 && (
            <div className="app-chart__paper" style={{ width }}>
              <ChartSvg
                chartType={chartType}
                labels={limited.labels}
                values={limited.values}
                measure={measure}
                withUnit={unitOf}
                width={width}
                onSvg={holdSvg}
                summary={summary}
              />
            </div>
          )
        )}
      </div>
      <div className="ds-row app-chart__actions">
        <button type="button" className="ds-button ds-button--quiet" onClick={() => downloadCsv(result)}>
          Download CSV
        </button>
        {!horizontal && (
          <button type="button" className="ds-button ds-button--quiet" onClick={savePng}>
            Download PNG
          </button>
        )}
        <span className="ds-help">The CSV holds all {labels.length.toLocaleString()} groups, not only the plotted ones.</span>
      </div>
      {failure?.result === result && <p className="ds-help ds-help--error" role="alert">{failure.message}</p>}
      {limited.note && <p className="ds-help">{limited.note}</p>}
      {result.warnings.map((warning) => (
        <p key={warning} className="ds-help">{warning}</p>
      ))}
      <details className="app-details">
        <summary>Show the values as a table</summary>
        <div className="app-table-wrap">
          <table className="app-table">
            <caption>
              {measure} by {labelFor(vocab, plan.groupBy)}
            </caption>
            <thead>
              <tr>
                <th scope="col">{labelFor(vocab, plan.groupBy)}</th>
                <th scope="col">{measure}</th>
              </tr>
            </thead>
            <tbody>
              {labels.map((label, index) => (
                <tr key={`${index}-${label}`}>
                  <th scope="row">{label}</th>
                  <td>{unitOf(exact(values[index] ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
