import { arcPath, formatTick, niceTicks, OTHER_LABEL, scaleLinear, thinIndexes, truncateLabel } from '../lib/chartGeometry'
import { parseNumericCell } from '../lib/dataEngine'
import type { ChartType } from '../types'

interface ChartSvgProps {
  chartType: ChartType
  labels: string[]
  values: number[]
  /** The measure in words, used for the line-end label and the marks' hover text. */
  measure: string
  /** Appends the column's unit to an exact value, when it has one. */
  withUnit: (text: string) => string
  width: number
  /** Receives the <svg> element, for the PNG export. */
  onSvg: (element: SVGSVGElement | null) => void
  summary: string
}

const TICK_LABEL_MAX = 12
const TOP = 26
const SLOTS = 8

const exact = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 })

interface Frame {
  left: number
  right: number
  top: number
  bottom: number
  height: number
  width: number
}

/** Room for the y labels on the left and the category labels below, from the labels themselves. */
function frameFor(width: number, ticks: number[], labels: string[], rotate: boolean, narrow: boolean): Frame {
  const widest = Math.max(...ticks.map((tick) => formatTick(tick).length))
  const left = Math.max(36, widest * 8 + 14)
  const longest = Math.min(TICK_LABEL_MAX, Math.max(0, ...labels.map((label) => label.length)))
  const bottom = rotate ? Math.round(14 + longest * 6.4 * 0.5 + 24) : 30
  const height = narrow ? 260 : 320
  return { left, right: 16, top: TOP, bottom, height, width }
}

function Axes({ frame, ticks, y }: { frame: Frame; ticks: number[]; y: (value: number) => number }) {
  return (
    <>
      <g className="ds-c-grid">
        {ticks.map((tick) => (
          <line key={tick} x1={frame.left} x2={frame.width - frame.right} y1={y(tick)} y2={y(tick)} />
        ))}
      </g>
      <line className="ds-c-axis" x1={frame.left} x2={frame.width - frame.right} y1={y(0)} y2={y(0)} />
      <g className="ds-c-tick">
        {ticks.map((tick) => (
          <text key={tick} x={frame.left - 8} y={y(tick) + 4} textAnchor="end">
            {formatTick(tick)}
          </text>
        ))}
      </g>
    </>
  )
}

function CategoryLabels({
  frame, labels, x, rotate, baseline,
}: { frame: Frame; labels: string[]; x: (index: number) => number; rotate: boolean; baseline: number }) {
  const longest = Math.min(TICK_LABEL_MAX, Math.max(1, ...labels.map((label) => label.length)))
  const fit = Math.max(1, Math.floor((frame.width - frame.left - frame.right) / (rotate ? 18 : longest * 7.4 + 14)))
  const show = thinIndexes(labels.length, fit)
  return (
    <g className="ds-c-tick">
      {labels.map((label, index) => {
        if (!show.has(index)) return null
        const cx = x(index)
        const text = truncateLabel(label, TICK_LABEL_MAX)
        return rotate ? (
          <text key={`${index}-${label}`} x={cx} y={baseline + 14} textAnchor="end" transform={`rotate(-30 ${cx} ${baseline + 14})`}>
            <title>{label}</title>
            {text}
          </text>
        ) : (
          <text key={`${index}-${label}`} x={cx} y={baseline + 18} textAnchor="middle">
            <title>{label}</title>
            {text}
          </text>
        )
      })}
    </g>
  )
}

/** The index of the value farthest from zero: the mark that earns a direct label. */
function extremeIndex(values: number[]): number {
  return values.reduce((best, value, index) => (Math.abs(value) > Math.abs(values[best] ?? 0) ? index : best), 0)
}

function PieMarks({ labels, values, width, withUnit, onSvg, summary }: ChartSvgProps) {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0)
  const stacked = width < 520
  const radius = Math.min(stacked ? width / 2 - 20 : 120, 120)
  const cx = stacked ? width / 2 : radius + 24
  const cy = radius + 20
  const rowH = 24
  const legendX = stacked ? 16 : cx + radius + 36
  const legendTop = stacked ? cy + radius + 24 : 28
  const height = stacked ? legendTop + labels.length * rowH + 8 : Math.max(cy + radius + 20, legendTop + labels.length * rowH + 8)
  const shares = labels.map((_, index) => (total > 0 ? Math.max(0, values[index] ?? 0) / total : 0))
  const slices = labels.map((label, index) => {
    const before = shares.slice(0, index).reduce((sum, share) => sum + share, 0)
    const share = shares[index] ?? 0
    return { label, index, start: before * Math.PI * 2, end: (before + share) * Math.PI * 2, share }
  })
  return (
    <svg ref={onSvg} viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={summary}>
      <g>
        {slices.map(({ label, index, start, end }) =>
          end > start ? (
            <path
              key={`${index}-${label}`}
              d={arcPath(cx, cy, radius * 0.56, radius, start, end)}
              className="app-slice"
              style={{ fill: label === OTHER_LABEL ? 'var(--viz-other)' : `var(--viz-${(index % SLOTS) + 1})` }}
            >
              <title>{`${label}: ${withUnit(exact(values[index] ?? 0))}`}</title>
            </path>
          ) : null,
        )}
      </g>
      <g>
        {slices.map(({ label, index, share }, row) => {
          const y = legendTop + row * rowH
          return (
            <g key={`${index}-${label}`}>
              <rect
                x={legendX}
                y={y - 10}
                width={12}
                height={12}
                rx={2}
                className="app-slice"
                style={{ fill: label === OTHER_LABEL ? 'var(--viz-other)' : `var(--viz-${(index % SLOTS) + 1})` }}
              />
              <text className="ds-c-tick" x={legendX + 20} y={y} style={{ fill: 'var(--ds-text)' }}>
                {truncateLabel(label, stacked ? 22 : 20)}
                <title>{label}</title>
              </text>
              <text className="ds-c-tick" x={width - 16} y={y} textAnchor="end">
                {`${Math.round(share * 100)}%`}
              </text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}

/** Bars, lines, areas and scatter on the v3 chart frame: grid, axis and tick classes, the accent as series 1, direct labels. */
export default function ChartSvg(props: ChartSvgProps) {
  const { chartType, labels, values, measure, withUnit, width, summary, onSvg } = props
  if (chartType === 'pie') return <PieMarks {...props} />

  const count = labels.length
  const narrow = width < 480
  const rotate = count > 6 || labels.some((label) => label.length > 8)
  const isScatter = chartType === 'scatter'
  const xs = labels.map((label, index) => (parseNumericCell(label) !== null ? (parseNumericCell(label) as number) : index + 1))
  const ticks = niceTicks(Math.min(...values), Math.max(...values))
  const frame = frameFor(width, ticks, labels, rotate && !isScatter, narrow)
  const plotW = Math.max(40, width - frame.left - frame.right)
  const plotBottom = frame.height - frame.bottom
  const y = scaleLinear(ticks[0] ?? 0, ticks[ticks.length - 1] ?? 1, plotBottom, frame.top)
  const band = plotW / Math.max(1, count)
  const bandX = (index: number) => frame.left + band * index + band / 2
  const xTicks = isScatter ? niceTicks(Math.min(...xs), Math.max(...xs), 5) : []
  const sx = isScatter ? scaleLinear(Math.min(0, xTicks[0] ?? 0), xTicks[xTicks.length - 1] ?? 1, frame.left, frame.left + plotW) : bandX
  const at = (index: number) => (isScatter ? sx(xs[index] ?? 0) : bandX(index))
  const top = extremeIndex(values)
  const topLabel = formatTick(values[top] ?? 0)
  const hover = (index: number) => `${labels[index]}: ${withUnit(exact(values[index] ?? 0))}`
  const zero = y(0)

  const barW = Math.min(band * 0.7, 56)
  const showAllValues = chartType === 'bar' && count <= 12 && band >= 38

  const path = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${at(index).toFixed(1)} ${y(value).toFixed(1)}`).join('')
  const lastIndex = count - 1
  const endY = y(values[lastIndex] ?? 0)
  const topY = y(values[top] ?? 0)
  const sameMark = top === lastIndex
  const collide = !sameMark && Math.abs(endY - topY) < 18 && Math.abs(at(lastIndex) - at(top)) < 110
  const endLabel = sameMark ? `${measure}: ${topLabel}` : measure
  const endLabelY = collide ? endY + 22 : endY - 8

  return (
    <svg ref={onSvg} viewBox={`0 0 ${width} ${frame.height}`} width={width} height={frame.height} role="img" aria-label={summary}>
      <Axes frame={frame} ticks={ticks} y={y} />
      {isScatter ? (
        <g className="ds-c-tick">
          {xTicks.map((tick) => (
            <text key={tick} x={sx(tick)} y={plotBottom + 18} textAnchor="middle">
              {formatTick(tick)}
            </text>
          ))}
        </g>
      ) : (
        <CategoryLabels frame={frame} labels={labels} x={bandX} rotate={rotate} baseline={plotBottom} />
      )}

      {chartType === 'bar' && (
        <g className="ds-c-s1 app-bar">
          {values.map((value, index) => (
            <rect
              key={`${index}-${labels[index]}`}
              x={bandX(index) - barW / 2}
              y={Math.min(y(value), zero)}
              width={barW}
              height={Math.max(2, Math.abs(zero - y(value)))}
              rx={3}
            >
              <title>{hover(index)}</title>
            </rect>
          ))}
        </g>
      )}

      {chartType === 'bar' && (
        <g>
          {values.map((value, index) =>
            showAllValues || index === top ? (
              <text
                key={`v-${index}`}
                className="ds-c-label"
                style={{ fill: 'var(--ds-text)' }}
                x={bandX(index)}
                y={value >= 0 ? y(value) - 6 : y(value) + 16}
                textAnchor="middle"
              >
                {formatTick(value)}
              </text>
            ) : null,
          )}
        </g>
      )}

      {(chartType === 'line' || chartType === 'area') && (
        <>
          {chartType === 'area' && <path className="ds-c-s1 app-area" d={`${path}L${at(lastIndex).toFixed(1)} ${zero}L${at(0).toFixed(1)} ${zero}Z`} />}
          <path className="ds-c-line ds-c-s1" d={path} />
        </>
      )}

      {(chartType === 'line' || chartType === 'area' || isScatter) && count <= 60 && (
        <g className="ds-c-s1 app-dot">
          {values.map((value, index) => (
            <circle key={`${index}-${labels[index]}`} cx={at(index)} cy={y(value)} r={isScatter ? 4 : 3.5}>
              <title>{hover(index)}</title>
            </circle>
          ))}
        </g>
      )}

      {(chartType === 'line' || chartType === 'area') && (
        <g>
          {collide && <line className="ds-c-grid" x1={at(lastIndex)} x2={at(lastIndex)} y1={endY} y2={endLabelY - 12} />}
          <text className="ds-c-label ds-c-s1" x={at(lastIndex)} y={endLabelY} textAnchor="end">
            {endLabel}
          </text>
          {!sameMark && (
            <text className="ds-c-label" style={{ fill: 'var(--ds-text)' }} x={at(top)} y={topY - 10} textAnchor="middle">
              {topLabel}
            </text>
          )}
        </g>
      )}

      {isScatter && (
        <text className="ds-c-label" style={{ fill: 'var(--ds-text)' }} x={at(top)} y={topY - 10} textAnchor="middle">
          {topLabel}
        </text>
      )}
    </svg>
  )
}
