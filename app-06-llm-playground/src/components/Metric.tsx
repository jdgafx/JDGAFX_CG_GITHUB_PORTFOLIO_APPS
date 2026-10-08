interface MetricProps {
  label: string
  value: string
  hint?: string
  mono?: boolean
}

// One figure in the readout strip: a label, the value in tabular figures, and an optional note.
export function Metric({ label, value, hint, mono = false }: MetricProps) {
  return (
    <div className="ds-strip__item">
      <div className="ds-strip__label">{label}</div>
      <div className={mono ? 'ds-strip__value ds-mono' : 'ds-strip__value'}>{value}</div>
      {hint && <div className="ds-strip__hint">{hint}</div>}
    </div>
  )
}
