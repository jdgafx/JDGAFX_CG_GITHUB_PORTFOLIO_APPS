import { parseInline } from '../lib/markdown'

/** Model prose as elements: strong, emphasis and code become tags, anything else stays text. Never raw markers or HTML. */
export function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, i) => {
        if (part.kind === 'em') return <em key={i}>{part.text}</em>
        if (part.kind === 'strong') return <strong key={i}>{part.text}</strong>
        if (part.kind === 'code') return <code key={i}>{part.text}</code>
        return part.text
      })}
    </>
  )
}
