import { deltaParts } from '../lib/format'

// A rating change: an arrow for the direction (green up, muted down, never danger red) and the figure in the text colour.
export function Delta({ delta }: { delta: number }) {
  const { dir, value } = deltaParts(delta)
  const word = dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'unchanged'
  return (
    <span className="arena-delta" aria-label={dir === 'flat' ? 'rating unchanged' : `rating ${word} ${value}`}>
      {dir !== 'flat' && <span className={`arena-delta__arrow arena-delta__arrow--${dir}`} aria-hidden="true">{dir === 'up' ? '▲' : '▼'}</span>}
      <span aria-hidden="true">{dir === 'flat' ? '±0.0' : value}</span>
    </span>
  )
}
