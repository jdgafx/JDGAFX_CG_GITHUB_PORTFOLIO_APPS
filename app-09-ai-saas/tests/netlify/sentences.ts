import type { Segment } from '../../shared/types'

/**
 * The 36 captured paragraphs (SP2, e2ed80c) were written before the model listed its sentences, so a test cuts them at every
 * stop inside a text segment ("4.5" and "29,696,229" have none: a stop needs a space or the end after it) and wraps each
 * sentence as the model now sends it: { sentence: Segment[] }.
 */
export function asSentences(flat: Segment[]): Array<{ sentence: Segment[] }> {
  const out: Segment[][] = [[]]
  for (const seg of flat) {
    if (seg.t !== 'text') {
      out[out.length - 1]!.push(seg)
      continue
    }
    for (const piece of seg.s.match(/[^]*?[.!?](?=\s|$)\s*|[^]+$/g) ?? []) {
      out[out.length - 1]!.push({ t: 'text', s: piece })
      if (/[.!?]\s*$/.test(piece)) out.push([])
    }
  }
  return out.filter((x) => x.length > 0).map((sentence) => ({ sentence }))
}
