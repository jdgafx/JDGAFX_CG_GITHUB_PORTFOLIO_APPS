import { Fragment, useMemo, type ReactNode } from 'react'
import type { ParsedAnswer } from '../lib/evidence'
import { parseInline } from '../lib/markdown'

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, i) => {
        if (part.kind === 'em') return <em key={i}>{part.text}</em>
        if (part.kind === 'strong') return <strong key={i}>{part.text}</strong>
        if (part.kind === 'code') return <code key={i}>{part.text}</code>
        return <Fragment key={i}>{part.text}</Fragment>
      })}
    </>
  )
}

/** Where a citation button sits, so focus can return to it when the source panel closes. */
export const citeKey = (turnId: string, index: number): string => `${turnId}:${index}`

interface AnswerBodyProps {
  turnId: string
  parsed: ParsedAnswer
  /** The passage open in the source panel, if it belongs to this answer. */
  selected: number | null
  onSelect: (index: number) => void
}

/** Cuts the parsed answer into paragraphs; a citation becomes a button that opens its passage. */
export function AnswerBody({ turnId, parsed, selected, onSelect }: AnswerBodyProps) {
  const paragraphs = useMemo(() => {
    const out: ReactNode[][] = [[]]
    parsed.parts.forEach((part, i) => {
      const current = out[out.length - 1] ?? []
      if (part.kind === 'cite') {
        current.push(
          <span key={i} className="docmind-cites">
            {part.indices.map(index => (
              <button
                key={index}
                type="button"
                className="docmind-cite"
                data-cite={citeKey(turnId, index)}
                aria-pressed={selected === index}
                aria-label={`Passage ${index + 1}: show the supporting sentence`}
                onClick={() => onSelect(index)}
              >
                {index + 1}
              </button>
            ))}
          </span>,
        )
        return
      }
      // The citation sits close to the word it follows, so the space before it is dropped.
      const beforeCite = parsed.parts[i + 1]?.kind === 'cite'
      const lines = part.text.split('\n')
      lines.forEach((raw, n) => {
        if (n > 0) out.push([])
        const target = out[out.length - 1] ?? current
        const line = beforeCite && n === lines.length - 1 ? raw.trimEnd() : raw
        if (line !== '') target.push(<Inline key={`${i}-${n}`} text={line} />)
      })
    })
    return out.filter(nodes => nodes.length > 0)
  }, [parsed, turnId, selected, onSelect])

  return (
    <div className="ds-lead__text">
      {paragraphs.map((nodes, i) => (
        <p key={i}>{nodes}</p>
      ))}
    </div>
  )
}
