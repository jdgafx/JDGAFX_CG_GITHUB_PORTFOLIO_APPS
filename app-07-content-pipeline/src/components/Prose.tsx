import { parseBlocks } from '../lib/blocks'
import Inline from './Inline'

// A model-written piece as headings, paragraphs and lists. Nothing here is HTML from the model.
export default function Prose({ text, className = 'prose' }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {parseBlocks(text).map((block, i) => {
        if (block.kind === 'rule') return <hr key={i} />
        if (block.kind === 'heading') {
          const Tag = (`h${block.level + 2}`) as 'h3' | 'h4' | 'h5' | 'h6'
          return <Tag key={i}><Inline text={block.text} /></Tag>
        }
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul'
          return <List key={i}>{block.items.map((item, k) => <li key={k}><Inline text={item} /></li>)}</List>
        }
        return <p key={i}><Inline text={block.text} /></p>
      })}
    </div>
  )
}
