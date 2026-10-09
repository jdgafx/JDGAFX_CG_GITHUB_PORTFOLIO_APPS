// Model prose as blocks: headings, paragraphs, lists, tables and code. The page renders the pieces as elements,
// so nothing the model writes can inject markup. Inline marks go through parseInline (markdown.ts).

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; text: string }

const FENCE = /^\s*```/
const HEADING = /^\s{0,3}(#{1,4})\s+(.*\S)\s*$/
const LIST_ITEM = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const QUOTE = /^\s*>\s?(.*)$/

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    LIST_ITEM.test(line) ||
    QUOTE.test(line) ||
    RULE.test(line) ||
    (line.includes('|') && next !== undefined && TABLE_RULE.test(next))
  )
}

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }
    if (FENCE.test(line)) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++])
      i += 1
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] })
      i += 1
      continue
    }
    if (RULE.test(line)) {
      i += 1
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      const head = cells(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]))
      blocks.push({ kind: 'table', head, rows })
      continue
    }
    const first = LIST_ITEM.exec(line)
    if (first) {
      const ordered = first[2] !== undefined
      const items: string[] = []
      while (i < lines.length) {
        const item = LIST_ITEM.exec(lines[i])
        if (item && (item[2] !== undefined) === ordered) {
          items.push(item[3].trim())
        } else if (item || !lines[i].trim() || !/^\s+\S/.test(lines[i]) || items.length === 0) {
          break
        } else {
          items[items.length - 1] += ` ${lines[i].trim()}`
        }
        i += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) body.push(QUOTE.exec(lines[i++])![1])
      blocks.push({ kind: 'quote', text: body.join(' ').trim() })
      continue
    }
    const body: string[] = [line.trim()]
    i += 1
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) body.push(lines[i++].trim())
    blocks.push({ kind: 'paragraph', text: body.join(' ') })
  }
  return blocks
}
