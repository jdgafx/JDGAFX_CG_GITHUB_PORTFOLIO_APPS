import { parseBlocks, type Block } from '../lib/blocks'
import { sentenceCase } from '../lib/titles'
import { citesOf, sentencePieces, textUnits } from '../../netlify/shared/citecheck'
import type { CiteMark } from '../lib/check'
import CiteBadge from './CiteBadge'
import Inline from './Inline'

/** Marks one cited sentence by its number and its words (the numbering extractClaims uses). */
export type MarkFor = (id: number, text: string) => CiteMark

// One text unit as runs: a run of sentences with no citation, or one cited sentence with its claim number.
type Run = { text: string; id?: undefined } | { text: string; id: number }

// Cuts every text unit of every block into runs, numbering the cited sentences in reading order. This is the
// numbering of extractClaims, which the server used, so a mark lands on the sentence it was made for.
function planRuns(blocks: Block[]): Run[][][] {
  let id = 0
  return blocks.map(block => textUnits(block).map(unit => {
    const runs: Run[] = []
    for (const piece of sentencePieces(unit)) {
      if (citesOf(piece).length > 0) {
        id += 1
        runs.push({ text: piece, id })
      } else if (runs.length > 0 && runs[runs.length - 1]?.id === undefined) {
        const last = runs[runs.length - 1]
        if (last) last.text += piece
      } else runs.push({ text: piece })
    }
    return runs
  }))
}

function Sentence({ run, marks }: { run: Run; marks: MarkFor }) {
  if (run.id === undefined) return <Inline text={run.text} />
  const mark = marks(run.id, run.text.trim())
  return (
    <>
      <span className="cite" data-cite={mark.view}>
        <Inline text={run.text.trimEnd()} />
        {' '}
        <CiteBadge view={mark.view} />
        {mark.note && mark.view !== 'confirmed' && <span className="cite-note">{mark.note}</span>}
      </span>
      {run.text.slice(run.text.trimEnd().length)}
    </>
  )
}

function Unit({ runs, marks }: { runs: Run[]; marks: MarkFor }) {
  return <>{runs.map((run, i) => <Sentence key={i} run={run} marks={marks} />)}</>
}

// A model-written piece as headings, paragraphs and lists. Nothing here is HTML from the model.
// Headings go to sentence case; `names` are the words that keep their capitals. With `marks`, every cited
// sentence carries its check state after it.
export default function Prose({ text, className = 'prose', names = [], marks }: { text: string; className?: string; names?: string[]; marks?: MarkFor }) {
  const blocks = parseBlocks(text)
  const plan = marks ? planRuns(blocks) : null
  return (
    <div className={className}>
      {blocks.map((block, i) => {
        const units = plan?.[i] ?? []
        if (block.kind === 'rule') return <hr key={i} />
        if (block.kind === 'heading') {
          const Tag = (`h${block.level + 2}`) as 'h3' | 'h4' | 'h5' | 'h6'
          // A heading keeps its sentence case as one piece; the states of its cited sentences follow it.
          const cited = (units[0] ?? []).filter(run => run.id !== undefined)
          return (
            <Tag key={i}>
              <Inline text={sentenceCase(block.text, names)} />
              {marks && cited.map(run => run.id === undefined ? null : (
                <span key={run.id}>{' '}<CiteBadge view={marks(run.id, run.text.trim()).view} /></span>
              ))}
            </Tag>
          )
        }
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul'
          return <List key={i}>{block.items.map((item, k) => <li key={k}>{marks && units[k] ? <Unit runs={units[k]} marks={marks} /> : <Inline text={item} />}</li>)}</List>
        }
        return <p key={i}>{marks && units[0] ? <Unit runs={units[0]} marks={marks} /> : <Inline text={block.text} />}</p>
      })}
    </div>
  )
}
