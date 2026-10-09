import { parseInline } from '../lib/markdown'

/** Model text with the safe inline-markdown subset drawn as elements. No HTML from the text is ever inserted. */
export function Md({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, i) => {
        if (part.kind === 'strong') return <strong key={i}>{part.text}</strong>
        if (part.kind === 'em') return <em key={i}>{part.text}</em>
        if (part.kind === 'code') return <code key={i}>{part.text}</code>
        return part.text
      })}
    </>
  )
}
