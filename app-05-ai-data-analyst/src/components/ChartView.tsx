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

function formatValue(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  if (!Number.isInteger(value)) return value.toFixed(2)
  return value.toLocaleString()
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

export default function ChartView({ result }: ChartViewProps) {
  const { labels, datasets, queryPlan } = result
  const firstDataset = datasets[0]
  const values = firstDataset?.values ?? []
  const datasetName = firstDataset?.name ?? 'value'

  const standardData = labels.map((label, i) => ({
    name: label,
    [datasetName]: values[i] ?? 0,
  }))

  const pieData = labels.map((label, i) => ({
    name: label,
    value: values[i] ?? 0,
  }))

  const scatterData = labels.map((label, i) => ({
    x: isNaN(parseFloat(label)) ? i + 1 : parseFloat(label),
    y: values[i] ?? 0,
    name: label,
  }))

  if (labels.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '320px',
          color: '#4a4a6a',
          fontSize: '14px',
        }}
      >
        No data matched the query criteria
      </div>
    )
  }

  const chartType = queryPlan.chartType

  return (
    <motion.div
      key={queryPlan.title}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      style={{ width: '100%', height: '360px' }}
    >
      <ResponsiveContainer width="100%" height="100%">
        {chartType === 'bar' ? (
          <BarChart data={standardData} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
            <CartesianGrid {...GRID_PROPS} vertical={false} />
            <XAxis
              dataKey="name"
              tick={TICK_STYLE}
              angle={-30}
              textAnchor="end"
              interval={0}
              height={60}
            />
            <YAxis tick={TICK_STYLE} tickFormatter={formatValue} width={60} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey={datasetName} fill="#ff3366" radius={[4, 4, 0, 0]}>
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
            <XAxis
              dataKey="name"
              tick={TICK_STYLE}
              angle={-30}
              textAnchor="end"
              interval={0}
              height={60}
            />
            <YAxis tick={TICK_STYLE} tickFormatter={formatValue} width={60} />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey={datasetName}
              stroke="#ff3366"
              strokeWidth={2.5}
              dot={{ fill: '#ff3366', r: 4, strokeWidth: 0 }}
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
            <XAxis
              dataKey="name"
              tick={TICK_STYLE}
              angle={-30}
              textAnchor="end"
              interval={0}
              height={60}
            />
            <YAxis tick={TICK_STYLE} tickFormatter={formatValue} width={60} />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey={datasetName}
              stroke="#ff3366"
              strokeWidth={2.5}
              fill="url(#areaGradient)"
              dot={{ fill: '#ff3366', r: 3, strokeWidth: 0 }}
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
            >
              {pieData.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={PIE_COLORS[index % PIE_COLORS.length] ?? '#ff3366'}
                />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ color: '#8a8aaa', fontSize: '12px', fontFamily: 'DM Sans' }} />
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
            <Scatter data={scatterData} fill="#ff3366" />
          </ScatterChart>
        )}
      </ResponsiveContainer>
    </motion.div>
  )
}
