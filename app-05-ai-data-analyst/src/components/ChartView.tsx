import { motion } from 'framer-motion'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
  ZAxis,
} from 'recharts'
import type { AnalysisResult } from '../types'

interface ChartViewProps {
  result: AnalysisResult
  datasetRowCount?: number
}

interface TooltipEntry {
  value: number
  name: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string
}

const PIE_COLORS = [
  '#ff3366',
  '#e82e5c',
  '#ff6b9d',
  '#cc2952',
  '#ff1a4d',
  '#ff99b8',
  '#ff4d7d',
  '#b3234a',
]

/** Above these counts the axis and legend stop being readable, so groups are collapsed. */
const MAX_BAR_GROUPS = 30
const MAX_PIE_SLICES = 12
const OTHER_LABEL = 'Other'

function formatValue(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  if (!Number.isInteger(value)) return value.toFixed(2)
  return value.toLocaleString()
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
      note: `Showing the ${keep.length} largest of ${labels.length} groups — the remaining ${tail.length} are combined as "Other".`,
    }
  }

  return {
    labels: outLabels,
    values: outValues,
    note: `Showing the ${keep.length} largest of ${labels.length} groups — ${tail.length} smaller groups are not plotted.`,
  }
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div
      style={{
        background: '#0e0e1c',
        border: '1px solid rgba(255,51,102,0.3)',
        borderRadius: '8px',
        padding: '10px 14px',
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      {label && (
        <p style={{ color: '#8a8aaa', fontSize: '11px', marginBottom: '4px', marginTop: 0 }}>
          {label}
        </p>
      )}
      {payload.map((entry, i) => (
        <p key={i} style={{ color: '#ff3366', fontSize: '14px', fontWeight: 600, margin: 0 }}>
          {formatValue(entry.value)}
        </p>
      ))}
    </div>
  )
}

const TICK_STYLE = { fill: '#8a8aaa', fontSize: 11, fontFamily: 'DM Sans, sans-serif' }
const GRID_PROPS = { stroke: 'rgba(255,255,255,0.06)', strokeDasharray: '3 3' }

export default function ChartView({ result, datasetRowCount }: ChartViewProps) {
  const { labels, datasets, queryPlan } = result
  const firstDataset = datasets[0]
  const values = firstDataset?.values ?? []
  const datasetName = firstDataset?.name ?? 'value'
  const chartType = queryPlan.chartType
  const combinable = queryPlan.aggregate.fn === 'sum' || queryPlan.aggregate.fn === 'count'

  if (labels.length === 0) {
    return (
      <div
        role="status"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '240px',
          color: '#4a4a6a',
          fontSize: '14px',
          textAlign: 'center',
          padding: '0 20px',
        }}
      >
        {datasetRowCount === 0
          ? 'This dataset has a header row but no data rows, so there is nothing to chart.'
          : 'No rows matched this query. Try loosening the filter in your question.'}
      </div>
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
  const topIndex = plotValues.reduce(
    (best, v, i) => (Math.abs(v) > Math.abs(plotValues[best] ?? 0) ? i : best),
    0,
  )
  const summary = `${chartType} chart. ${queryPlan.aggregate.fn} of ${queryPlan.aggregate.field} by ${queryPlan.groupBy}, across ${labels.length} groups. Highest: ${plotLabels[topIndex]} at ${formatValue(plotValues[topIndex] ?? 0)}.${combinable ? ` Combined total ${formatValue(total)}.` : ''}`

  const axisProps = {
    dataKey: 'name',
    tick: TICK_STYLE,
    angle: -30,
    textAnchor: 'end' as const,
    interval: tickInterval,
    height: 60,
  }

  return (
    <div>
      <motion.div
        key={queryPlan.title}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="dp-chart"
        role="img"
        aria-label={summary}
      >
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'bar' ? (
            <BarChart data={standardData} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
              <CartesianGrid {...GRID_PROPS} vertical={false} />
              <XAxis {...axisProps} />
              <YAxis tick={TICK_STYLE} tickFormatter={formatValue} width={60} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey={datasetName} fill="#ff3366" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {standardData.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={`rgba(255,51,102,${0.6 + (index % 3) * 0.13})`}
                  />
                ))}
              </Bar>
            </BarChart>
          ) : chartType === 'line' ? (
            <LineChart data={standardData} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis {...axisProps} />
              <YAxis tick={TICK_STYLE} tickFormatter={formatValue} width={60} />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey={datasetName}
                stroke="#ff3366"
                strokeWidth={2.5}
                dot={plotLabels.length > MAX_BAR_GROUPS ? false : { fill: '#ff3366', r: 4, strokeWidth: 0 }}
                activeDot={{ r: 6, fill: '#ff6b9d' }}
              />
            </LineChart>
          ) : chartType === 'area' ? (
            <AreaChart data={standardData} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
              <defs>
                <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ff3366" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#ff3366" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis {...axisProps} />
              <YAxis tick={TICK_STYLE} tickFormatter={formatValue} width={60} />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey={datasetName}
                stroke="#ff3366"
                strokeWidth={2.5}
                fill="url(#areaGradient)"
                dot={plotLabels.length > MAX_BAR_GROUPS ? false : { fill: '#ff3366', r: 3, strokeWidth: 0 }}
              />
            </AreaChart>
          ) : chartType === 'pie' ? (
            <PieChart margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius="68%"
                innerRadius="38%"
                paddingAngle={3}
                isAnimationActive={false}
              >
                {pieData.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={PIE_COLORS[index % PIE_COLORS.length] ?? '#ff3366'}
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{
                  color: '#8a8aaa',
                  fontSize: '12px',
                  fontFamily: 'DM Sans',
                  maxHeight: '72px',
                  overflowY: 'auto',
                }}
              />
            </PieChart>
          ) : (
            <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="x"
                type="number"
                name="X"
                tick={TICK_STYLE}
                tickFormatter={formatValue}
              />
              <YAxis
                dataKey="y"
                type="number"
                name="Y"
                tick={TICK_STYLE}
                tickFormatter={formatValue}
                width={60}
              />
              <ZAxis range={[40, 40]} />
              <Tooltip
                cursor={{ strokeDasharray: '3 3', stroke: 'rgba(255,51,102,0.3)' }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null
                  const point = payload[0]?.payload as { name: string; y: number } | undefined
                  return (
                    <div
                      style={{
                        background: '#0e0e1c',
                        border: '1px solid rgba(255,51,102,0.3)',
                        borderRadius: '8px',
                        padding: '10px 14px',
                        fontFamily: 'DM Sans, sans-serif',
                      }}
                    >
                      {point && (
                        <>
                          <p style={{ color: '#8a8aaa', fontSize: '11px', margin: '0 0 4px' }}>
                            {point.name}
                          </p>
                          <p style={{ color: '#ff3366', fontSize: '14px', fontWeight: 600, margin: 0 }}>
                            {formatValue(point.y)}
                          </p>
                        </>
                      )}
                    </div>
                  )
                }}
              />
              <Scatter data={scatterData} fill="#ff3366" isAnimationActive={false} />
            </ScatterChart>
          )}
        </ResponsiveContainer>
      </motion.div>

      <p className="sr-only">{summary}</p>

      {limited.note && (
        <p
          style={{
            margin: '8px 2px 0',
            fontSize: '11.5px',
            color: '#8a8aaa',
            lineHeight: 1.5,
          }}
        >
          {limited.note}
        </p>
      )}
    </div>
  )
}
