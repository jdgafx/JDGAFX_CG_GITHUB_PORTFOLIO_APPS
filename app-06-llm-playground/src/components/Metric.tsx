interface MetricProps {
  label: string
  value: string
  hint?: string
}

export function Metric({ label, value, hint }: MetricProps) {
  return (
    <div className="ds-metric">
      <div className="ds-metric__label">{label}</div>
      <div className="ds-metric__value">{value}</div>
      {hint && <div className="ds-metric__hint">{hint}</div>}
    </div>
  )
}
