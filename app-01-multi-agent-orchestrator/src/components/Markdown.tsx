import type { ReactNode } from 'react'
import { parseBlocks, parseInline, type Block } from '../lib/markdown'

/** Only web links become links. Anything else the model writes shows as plain text. */
const WEB_LINK = /^https?:\/\//i

function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, i) => {
        switch (part.kind) {
          case 'bold':
            return <strong key={i}>{part.text}</strong>
          case 'italic':
            return <em key={i}>{part.text}</em>
          case 'code':
            return <code key={i}>{part.text}</code>
          case 'link':
            return WEB_LINK.test(part.href) ? (
              <a key={i} href={part.href} target="_blank" rel="noreferrer noopener">
                {part.text}
              </a>
            ) : (
              <span key={i}>{part.text}</span>
            )
          default:
            return <span key={i}>{part.text}</span>
        }
      })}
    </>
  )
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading': {
      const Tag = block.level === 1 ? 'h3' : block.level === 2 ? 'h4' : 'h5'
      return (
        <Tag>
          <InlineText text={block.text} />
        </Tag>
      )
    }
    case 'quote':
      return (
        <blockquote>
          <InlineText text={block.text} />
        </blockquote>
      )
    case 'code':
      return (
        <pre>
          <code>{block.lines.join('\n')}</code>
        </pre>
      )
    case 'table':
      return (
        <div className="md-table">
          <table>
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i}>
                    <InlineText text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>
                      <InlineText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'rule':
      return <hr />
    case 'paragraph':
      return (
        <p>
          <InlineText text={block.text} />
        </p>
      )
    case 'bullet':
    case 'numbered':
    case 'blank':
      return null
  }
}

/** Consecutive bullets (or numbers) become one list, so the markup matches the text. */
function Blocks({ blocks }: { blocks: Block[] }) {
  const out: ReactNode[] = []
  let items: ReactNode[] = []
  let listKind: 'bullet' | 'numbered' | null = null

  const flush = () => {
    if (listKind === 'bullet') out.push(<ul key={out.length}>{items}</ul>)
    if (listKind === 'numbered') out.push(<ol key={out.length}>{items}</ol>)
    items = []
    listKind = null
  }

  blocks.forEach((block, i) => {
    if (block.kind === 'bullet' || block.kind === 'numbered') {
      if (listKind !== block.kind) flush()
      listKind = block.kind
      items.push(
        <li key={i}>
          <InlineText text={block.text} />
        </li>,
      )
      return
    }
    flush()
    out.push(<BlockView key={i} block={block} />)
  })
  flush()

  return <>{out}</>
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <Blocks blocks={parseBlocks(text)} />
    </div>
  )
}
