interface MetricCardProps {
  label: string
  value: string
  /** Signed percentage change. Shown verbatim, never flipped to suit the colour. */
  trend: number
  /** Whether a rising number is good. Decides the verdict word; the arrow follows the sign. */
  higherIsBetter: boolean
}

/** One summary figure: its label, its value, and the change against the period before. */
export default function MetricCard({ label, value, trend, higherIsBetter }: MetricCardProps) {
  const rising = trend > 0
  const flat = trend === 0
  const improved = rising === higherIsBetter
  const arrow = flat ? '→' : rising ? '▲' : '▼'
  const verdict = flat ? 'no change' : improved ? 'better' : 'worse'
  const sign = trend > 0 ? '+' : ''
  const tone = flat ? '' : improved ? ' hub-trend--better' : ' hub-trend--worse'

  return (
    <div className="ds-strip__item">
      <dt className="ds-strip__label">{label}</dt>
      <dd className="ds-strip__value ds-num">{value}</dd>
      <dd className={`ds-strip__hint${tone}`}>
        <span aria-hidden="true">{arrow} </span>
        {`${sign}${trend}%`}, {verdict}
      </dd>
    </div>
  )
}
