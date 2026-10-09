import { parseInline } from './markdown'

/** Model text with its markdown markers taken out, for places that cannot show emphasis (a status line, a title). */
export function plainText(text: string): string {
  return parseInline(text)
    .map((piece) => piece.text)
    .join('')
}
