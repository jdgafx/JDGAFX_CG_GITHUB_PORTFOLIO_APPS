interface MetricCardProps {
  label: string
  value: string
  /** Signed percentage change. Shown verbatim, never flipped to suit the colour. */
  trend: number
  /** Whether a rising number is good. Decides the verdict word; the arrow follows the sign. */
  higherIsBetter: boolean
}

export default function MetricCard({ label, value, trend, higherIsBetter }: MetricCardProps) {
  const rising = trend > 0
  const flat = trend === 0
  const improved = rising === higherIsBetter
  const arrow = flat ? '→' : rising ? '▲' : '▼'
  const verdict = flat ? 'no change' : improved ? 'better' : 'worse'
  const sign = trend > 0 ? '+' : ''

  return (
    <div className="ds-metric">
      <p className="ds-metric__label">{label}</p>
      <p className="ds-metric__value">{value}</p>
      <p className="ds-metric__hint">
        <span aria-hidden="true">{arrow} </span>
        {`${sign}${trend}%`}, {verdict}
      </p>
    </div>
  )
}
