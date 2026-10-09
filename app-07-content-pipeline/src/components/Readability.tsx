import { STAGE_LABELS } from '../../netlify/shared/contract'
import type { ReadabilityPoint } from '../lib/compare'

function delta(value: number, previous: number | undefined, easierWhenHigher: boolean): string {
  if (previous === undefined) return 'first version'
  const change = Math.round((value - previous) * 10) / 10
  if (change === 0) return 'no change'
  const better = easierWhenHigher ? change > 0 : change < 0
  return `${change > 0 ? '+' : '−'}${Math.abs(change)}, ${better ? 'easier' : 'denser'}`
}

interface FigureProps {
  title: string
  help: string
  points: ReadabilityPoint[]
  pick: (point: ReadabilityPoint) => number
  easierWhenHigher: boolean
}

// Three versions are too few for a line chart, so each is a figure with its change from the one before.
function Figure({ title, help, points, pick, easierWhenHigher }: FigureProps) {
  return (
    <div className="trend">
      <p className="trend__title">{title} <span className="ds-help">{help}</span></p>
      <ol className="trend__row">
        {points.map((point, i) => {
          const value = pick(point)
          const before = i > 0 ? pick(points[i - 1] as ReadabilityPoint) : undefined
          return (
            <li key={point.stage} className="trend__cell">
              <span className="trend__stage">{STAGE_LABELS[point.stage]}</span>
              <span className="trend__value ds-mono">{value}</span>
              <span className="trend__delta">{delta(value, before, easierWhenHigher)}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export default function Readability({ points }: { points: ReadabilityPoint[] }) {
  if (points.length < 2) return null
  return (
    <div className="trends" aria-label="Readability by stage">
      <Figure title="Reading ease" help="Flesch, higher is easier" points={points} pick={p => p.figures.fleschEase} easierWhenHigher />
      <Figure title="Words per sentence" help="lower is easier" points={points} pick={p => p.figures.wordsPerSentence} easierWhenHigher={false} />
    </div>
  )
}
