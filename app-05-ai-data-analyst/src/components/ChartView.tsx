import type { CSSProperties } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { useChartPalette } from '../lib/chartPalette'
import type { AnalysisResult } from '../types'

interface ChartViewProps {
  result: AnalysisResult
}

interface TooltipEntry {
  value?: unknown
  payload?: { name?: string; y?: unknown }
}

interface ValueTooltipProps {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string | number
}

/** Above these counts the axis and legend stop being readable, so groups are collapsed. */
const MAX_BAR_GROUPS = 30
/** Eight categorical slots: seven groups and "Other". */
const MAX_PIE_SLICES = 8
const OTHER_LABEL = 'Other'
/** Category labels longer than this are cut with an ellipsis. The full name is the hover title. */
const TICK_MAX_CHARS = 12
/** On a phone, a chart with more groups than this scrolls sideways instead of crowding its labels. */
const WIDE_GROUPS = 8
const GROUP_MIN_PX = 40

function formatValue(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  if (!Number.isInteger(value)) return value.toFixed(2)
  return value.toLocaleString()
}

function formatExact(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

interface LimitedGroups {
  labels: string[]
  values: number[]
  note: string | null
}

/**
 * Keeps the largest groups so the axis stays readable. Sums the tail into "Other"
 * only when that is arithmetically meaningful (sum/count); for avg/min/max the
 * tail is dropped and the note says so.
 */
function limitGroups(
  labels: string[],
  values: number[],
  max: number,
  combine: boolean,
): LimitedGroups {
  if (labels.length <= max) return { labels, values, note: null }

  const ranked = labels
    .map((label, i) => ({ label, value: values[i] ?? 0 }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))

  const keep = combine ? ranked.slice(0, max - 1) : ranked.slice(0, max)
  const tail = ranked.slice(keep.length)

  const outLabels = keep.map((g) => g.label)
  const outValues = keep.map((g) => g.value)

  if (combine) {
    outLabels.push(OTHER_LABEL)
    outValues.push(tail.reduce((a, g) => a + g.value, 0))
    return {
      labels: outLabels,
      values: outValues,
      note: `Showing the ${keep.length} largest of ${labels.length} groups. The remaining ${tail.length} are combined as "${OTHER_LABEL}".`,
    }
  }

  return {
    labels: outLabels,
    values: outValues,
    note: `Showing the ${keep.length} largest of ${labels.length} groups. ${tail.length} smaller groups are not plotted.`,
  }
}

function ValueTooltip({ active, payload, label }: ValueTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const entry = payload[0]
  const point = entry?.payload
  const heading = point?.name ?? label
  const y = point?.y
  const raw = entry?.value
  const value = typeof y === 'number' ? y : typeof raw === 'number' ? raw : undefined
  return (
    <div className="viz-tooltip">
      {heading !== undefined && heading !== '' && <p className="viz-tooltip__label">{String(heading)}</p>}
      {value !== undefined && <p className="viz-tooltip__value">{formatValue(value)}</p>}
    </div>
  )
}

interface CategoryTickProps {
  x?: number
  y?: number
  payload?: { value?: unknown }
  fill: string
}

/** A category label at -30 degrees, cut to the tick limit. The full name is the hover title. */
function CategoryTick({ x = 0, y = 0, payload, fill }: CategoryTickProps) {
  const full = String(payload?.value ?? '')
  const shown = full.length > TICK_MAX_CHARS ? `${full.slice(0, TICK_MAX_CHARS - 1)}…` : full
  const anchorY = y + 8
  return (
    <text x={x} y={anchorY} fill={fill} fontSize={13} textAnchor="end" transform={`rotate(-30 ${x} ${anchorY})`}>
      <title>{full}</title>
      {shown}
    </text>
  )
}

export default function ChartView({ result }: ChartViewProps) {
  const palette = useChartPalette()
  const { labels, datasets, queryPlan } = result
  const values = datasets[0]?.values ?? []
  const datasetName = datasets[0]?.name ?? 'value'
  const chartType = queryPlan.chartType
  const combinable = queryPlan.aggregate.fn === 'sum' || queryPlan.aggregate.fn === 'count'

  if (labels.length === 0) {
    return (
      <p className="ds-empty" role="status">
        No rows matched this query. Try loosening the filter in your question.
      </p>
    )
  }

  const limited =
    chartType === 'pie'
      ? limitGroups(labels, values, MAX_PIE_SLICES, combinable)
      : chartType === 'bar'
        ? limitGroups(labels, values, MAX_BAR_GROUPS, combinable)
        : { labels, values, note: null }

  const plotLabels = limited.labels
  const plotValues = limited.values

  const standardData = plotLabels.map((label, i) => ({
    name: label,
    [datasetName]: plotValues[i] ?? 0,
  }))

  const pieData = plotLabels.map((label, i) => ({
    name: label,
    value: plotValues[i] ?? 0,
  }))

  const scatterData = plotLabels.map((label, i) => ({
    x: isNaN(parseFloat(label)) ? i + 1 : parseFloat(label),
    y: plotValues[i] ?? 0,
    name: label,
  }))

  // Every tick rendered is unusable past a few dozen categories, so let Recharts thin them.
  const tickInterval: 0 | 'preserveStartEnd' =
    plotLabels.length > MAX_BAR_GROUPS ? 'preserveStartEnd' : 0

  const total = plotValues.reduce((a, b) => a + b, 0)
  const largestIndex = plotValues.reduce(
    (best, v, i) => (Math.abs(v) > Math.abs(plotValues[best] ?? 0) ? i : best),
    0,
  )
  const summary = `${chartType} chart. ${queryPlan.aggregate.fn} of ${queryPlan.aggregate.field} by ${queryPlan.groupBy}, across ${labels.length} groups. Largest: ${plotLabels[largestIndex]} at ${formatValue(plotValues[largestIndex] ?? 0)}.${combinable ? ` Combined total ${formatValue(total)}.` : ''}`

  const wide =
    (chartType === 'bar' || chartType === 'line' || chartType === 'area') && plotLabels.length > WIDE_GROUPS
  const frameStyle = wide
    ? ({ '--viz-min': `${plotLabels.length * GROUP_MIN_PX}px` } as CSSProperties)
    : undefined

  const tick = { fill: palette.muted, fontSize: 13 }
  const grid = { stroke: palette.grid, strokeDasharray: '3 3' }
  const margin = { top: 10, right: 20, left: 10, bottom: 40 }
  const axisProps = {
    dataKey: 'name',
    tick: <CategoryTick fill={palette.muted} />,
    interval: tickInterval,
    height: 60,
  }
  const dotFor = (color: string, radius: number) =>
    plotLabels.length > MAX_BAR_GROUPS ? false : { fill: color, r: radius, strokeWidth: 0 }

  const renderChart = () => {
    if (chartType === 'bar') {
      return (
        <BarChart data={standardData} margin={margin}>
          <CartesianGrid {...grid} vertical={false} />
          <XAxis {...axisProps} />
          <YAxis tick={tick} tickFormatter={formatValue} width={60} />
          <Tooltip content={<ValueTooltip />} />
          <Bar dataKey={datasetName} fill={palette.accent} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      )
    }
    if (chartType === 'line') {
      return (
        <LineChart data={standardData} margin={margin}>
          <CartesianGrid {...grid} />
          <XAxis {...axisProps} />
          <YAxis tick={tick} tickFormatter={formatValue} width={60} />
          <Tooltip content={<ValueTooltip />} />
          <Line
            type="monotone"
            dataKey={datasetName}
            stroke={palette.accent}
            strokeWidth={2.5}
            dot={dotFor(palette.accent, 4)}
            activeDot={{ r: 6, fill: palette.accent }}
            isAnimationActive={false}
          />
        </LineChart>
      )
    }
    if (chartType === 'area') {
      return (
        <AreaChart data={standardData} margin={margin}>
          <CartesianGrid {...grid} />
          <XAxis {...axisProps} />
          <YAxis tick={tick} tickFormatter={formatValue} width={60} />
          <Tooltip content={<ValueTooltip />} />
          <Area
            type="monotone"
            dataKey={datasetName}
            stroke={palette.accent}
            strokeWidth={2.5}
            fill={palette.accent}
            fillOpacity={0.18}
            dot={dotFor(palette.accent, 3)}
            isAnimationActive={false}
          />
        </AreaChart>
      )
    }
    if (chartType === 'pie') {
      return (
        <PieChart margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius="68%"
            innerRadius="38%"
            paddingAngle={2}
            isAnimationActive={false}
          >
            {pieData.map((entry, index) => (
              <Cell
                key={entry.name}
                fill={entry.name === OTHER_LABEL ? palette.other : (palette.series[index] ?? palette.other)}
                stroke={palette.surface}
                strokeWidth={2}
              />
            ))}
          </Pie>
          <Tooltip content={<ValueTooltip />} />
          <Legend wrapperStyle={{ color: palette.muted, fontSize: 13, maxHeight: 72, overflowY: 'auto' }} />
        </PieChart>
      )
    }
    return (
      <ScatterChart margin={margin}>
        <CartesianGrid {...grid} />
        <XAxis dataKey="x" type="number" name="X" tick={tick} tickFormatter={formatValue} />
        <YAxis dataKey="y" type="number" name="Y" tick={tick} tickFormatter={formatValue} width={60} />
        <ZAxis range={[40, 40]} />
        <Tooltip content={<ValueTooltip />} cursor={{ strokeDasharray: '3 3', stroke: palette.accent }} />
        <Scatter data={scatterData} fill={palette.accent} isAnimationActive={false} />
      </ScatterChart>
    )
  }

  return (
    <div className="app-chart">
      <div className={wide ? 'ds-panel viz-panel viz-panel--wide' : 'ds-panel viz-panel'}>
        <div className="viz-frame" role="img" aria-label={summary} style={frameStyle}>
          <ResponsiveContainer width="100%" height="100%">
            {renderChart()}
          </ResponsiveContainer>
        </div>
      </div>
      {limited.note && <p className="ds-help">{limited.note}</p>}
      <details className="app-details">
        <summary>Show the values as a table</summary>
        <div className="ds-panel app-table-wrap">
          <table className="app-table">
            <caption>
              {queryPlan.aggregate.fn} of {queryPlan.aggregate.field} by {queryPlan.groupBy}
            </caption>
            <thead>
              <tr>
                <th scope="col">{queryPlan.groupBy}</th>
                <th scope="col">{queryPlan.aggregate.field}</th>
              </tr>
            </thead>
            <tbody>
              {labels.map((label, index) => (
                <tr key={`${index}-${label}`}>
                  <th scope="row">{label}</th>
                  <td>{formatExact(values[index] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
