import type { SourcePack } from '../../netlify/shared/sourcepack'

// A capitalised word in the middle of a sentence is a name (Rust, Mozilla, Hoare). The first word of a
// sentence is capitalised anyway, so it says nothing.
const MID_SENTENCE_NAME = /(?<=[a-z0-9,;:)] )[A-Z][\p{L}\p{N}'’-]*/gu

/**
 * Words a heading must keep capitalised when it is put into sentence case: the capitalised words of the
 * topic and the names found in the sources, each also with an "s" for a possessive. Order is not kept.
 */
export function namesFor(topic: string, pack: SourcePack): string[] {
  const found = new Set<string>()
  const add = (word: string) => {
    const bare = word.replace(/['’]s$/, '')
    found.add(bare)
    found.add(`${bare}s`)
  }
  for (const word of topic.split(/\s+/)) if (/^[A-Z]/.test(word)) add(word.replace(/[^\p{L}\p{N}'’-]/gu, ''))
  for (const source of pack.sources) {
    for (const match of source.summary.matchAll(MID_SENTENCE_NAME)) add(match[0])
  }
  found.delete('')
  found.delete('s')
  return [...found]
}
