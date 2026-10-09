import { parseBlocks, type Block } from '../lib/blocks'
import { parseInline } from '../lib/markdown'

// Inline marks become elements. Nothing from the model is ever set as HTML.
export function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((piece, index) => {
        if (piece.kind === 'strong') return <strong key={index}>{piece.text}</strong>
        if (piece.kind === 'em') return <em key={index}>{piece.text}</em>
        if (piece.kind === 'code') return <code key={index}>{piece.text}</code>
        return piece.text
      })}
    </>
  )
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading':
      return block.level <= 2 ? (
        <h3>
          <Inline text={block.text} />
        </h3>
      ) : (
        <h4>
          <Inline text={block.text} />
        </h4>
      )
    case 'paragraph':
      return (
        <p>
          <Inline text={block.text} />
        </p>
      )
    case 'quote':
      return (
        <blockquote>
          <Inline text={block.text} />
        </blockquote>
      )
    case 'code':
      return (
        <div className="ds-code-wrap">
          <pre className="ds-code vl-pre" tabIndex={0} role="region" aria-label="Code from the answer, scrolls sideways">
            {block.text}
          </pre>
        </div>
      )
    case 'list': {
      const items = block.items.map((item, index) => (
        <li key={index}>
          <Inline text={item} />
        </li>
      ))
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>
    }
    case 'table':
      // Wide tables scroll inside their own box instead of widening the page.
      return (
        <div className="vl-table" tabIndex={0} role="region" aria-label="Table from the answer, scrolls sideways">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th key={index} scope="col">
                    <Inline text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

/** The model's answer as blocks. `streaming` shows a caret after the last block while words are still arriving. */
export default function RichText({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div className={streaming ? 'vl-prose is-streaming' : 'vl-prose'}>
      {parseBlocks(text).map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  )
}
