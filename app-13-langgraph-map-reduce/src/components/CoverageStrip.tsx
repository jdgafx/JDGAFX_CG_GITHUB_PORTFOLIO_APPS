import { useRef, type KeyboardEvent } from 'react'
import type { Cell } from '../lib/evidence'

const KIND_WORD: Record<Cell['kind'], string> = { covered: '', uncited: 'not cited', 'no-points': 'no key points' }
/** The short word on the cell itself; the full reason is in its label and title. */
const CELL_WORD: Record<Cell['kind'], string> = { covered: '', uncited: 'not cited', 'no-points': 'no points' }

function describe(cell: Cell): string {
  const base =
    cell.kind === 'covered'
      ? `Chunk ${cell.id}, cited by ${cell.count} summary ${cell.count === 1 ? 'point' : 'points'}`
      : `Chunk ${cell.id}, missing: ${KIND_WORD[cell.kind]}`
  return cell.retried ? `${base}, retried` : base
}

function RetryMark() {
  return (
    <svg className="cell__retry" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface Props {
  cells: Cell[]
  /** Chunks the selected point cites, lit in the strip. */
  lit: ReadonlySet<number>
  /** The chunk whose detail is open, if any. */
  chosen: number | null
  /** The most points any one chunk has, for the legend's numeric scale. */
  max: number
  onChoose: (id: number) => void
}

/** One cell per chunk, shaded by how many summary points cite it. Left and Right move between cells. */
export function CoverageStrip({ cells, lit, chosen, max, onChoose }: Props) {
  const group = useRef<HTMLDivElement>(null)
  const dim = lit.size > 0

  function onKey(event: KeyboardEvent<HTMLDivElement>): void {
    const keys: Record<string, (i: number, n: number) => number> = {
      ArrowRight: (i, n) => Math.min(i + 1, n - 1),
      ArrowDown: (i, n) => Math.min(i + 1, n - 1),
      ArrowLeft: (i) => Math.max(i - 1, 0),
      ArrowUp: (i) => Math.max(i - 1, 0),
      Home: () => 0,
      End: (_i, n) => n - 1,
    }
    const move = keys[event.key]
    if (!move) return
    const buttons = [...(group.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    event.preventDefault()
    buttons[move(at, buttons.length)]?.focus()
  }

  return (
    <div className="strip">
      <div ref={group} className="strip__cells" role="group" aria-label="Chunks of the document, shaded by how many summary points cite each" onKeyDown={onKey}>
        {cells.map((cell) => (
          <button
            key={cell.id}
            type="button"
            className="cell"
            data-level={cell.level}
            data-kind={cell.kind}
            data-lit={lit.has(cell.id) ? 'true' : undefined}
            data-dim={dim && !lit.has(cell.id) ? 'true' : undefined}
            aria-pressed={chosen === cell.id}
            aria-label={describe(cell)}
            title={describe(cell)}
            onClick={() => onChoose(cell.id)}
          >
            <span className="cell__id">{cell.id}</span>
            <span className="cell__count">{cell.kind === 'covered' ? `${cell.count} ${cell.count === 1 ? 'pt' : 'pts'}` : CELL_WORD[cell.kind]}</span>
            {cell.retried && <RetryMark />}
          </button>
        ))}
      </div>
      <ul className="strip__legend" aria-label="How to read the strip">
        <li>
          <span className="strip__ramp" aria-hidden="true">
            <i data-level="1" />
            <i data-level="2" />
            <i data-level="3" />
            <i data-level="4" />
          </span>
          1 point to {max} {max === 1 ? 'point' : 'points'} cite the chunk
        </li>
        <li>
          <span className="strip__missing" aria-hidden="true" />
          missing from the summary
        </li>
        <li>
          <RetryMark />
          retried
        </li>
      </ul>
    </div>
  )
}
