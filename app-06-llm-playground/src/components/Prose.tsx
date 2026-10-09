import { parseInline } from '../lib/markdown'

// Model text with its inline markdown (strong, emphasis, code) shown as elements, never as literal marks or raw HTML.
export function Prose({ text }: { text: string }) {
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
