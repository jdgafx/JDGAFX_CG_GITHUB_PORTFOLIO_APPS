import { parseInline } from '../lib/markdown'

/** Model text with its emphasis, strong and code markers drawn as elements. Nothing in the text becomes markup. */
export default function Prose({ text }: { text: string }) {
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
