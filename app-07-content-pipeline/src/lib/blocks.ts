// Reads the Markdown a model writes (headings, bullet and numbered lists, paragraphs, rules) into blocks
// the page draws as elements. Inline marks inside a block go through parseInline. It never makes HTML.

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'rule' }

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const BULLET = /^\s*(?:[-*•])\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
    paragraph = []
  }
  for (const line of text.split('\n')) {
    const heading = HEADING.exec(line)
    const bullet = BULLET.exec(line)
    const numbered = NUMBERED.exec(line)
    if (!line.trim()) flush()
    else if (RULE.test(line)) {
      flush()
      blocks.push({ kind: 'rule' })
    } else if (heading) {
      flush()
      blocks.push({ kind: 'heading', level: Math.min(4, (heading[1] ?? '#').length) as 1 | 2 | 3 | 4, text: heading[2] ?? '' })
    } else if (bullet || numbered) {
      flush()
      const ordered = Boolean(numbered)
      const item = (bullet ?? numbered)?.[1] ?? ''
      const last = blocks[blocks.length - 1]
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(item)
      else blocks.push({ kind: 'list', ordered, items: [item] })
    } else paragraph.push(line.trim())
  }
  flush()
  return blocks
}
