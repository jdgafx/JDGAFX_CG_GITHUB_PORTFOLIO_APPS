/**
 * Lightweight markdown parser shared by the on-screen renderer and the PDF/DOCX
 * exporters, so every surface shows the same structure. Deliberately small — it
 * covers what the agents are prompted to emit, not the full CommonMark grammar.
 */

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'numbered'; marker: string; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; lang: string; lines: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'rule' }
  | { kind: 'paragraph'; text: string }
  | { kind: 'blank' }

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }

const INLINE_PATTERN = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g

const TABLE_DIVIDER = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map(cell => cell.trim())
}

export function parseInline(text: string): Inline[] {
  const parts = text.split(INLINE_PATTERN).filter(part => part !== undefined && part !== '')
  return parts.map<Inline>(part => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return { kind: 'bold', text: part.slice(2, -2) }
    }
    if (part.startsWith('__') && part.endsWith('__') && part.length > 4) {
      return { kind: 'bold', text: part.slice(2, -2) }
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return { kind: 'code', text: part.slice(1, -1) }
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part)
    if (link?.[1] && link[2]) {
      return { kind: 'link', text: link[1], href: link[2] }
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return { kind: 'italic', text: part.slice(1, -1) }
    }
    if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
      return { kind: 'italic', text: part.slice(1, -1) }
    }
    return { kind: 'text', text: part }
  })
}

export function parseBlocks(source: string): Block[] {
  const lines = source.split('\n')
  const blocks: Block[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? ''
    const line = raw.trim()

    const fence = /^```\s*(\S*)/.exec(line)
    if (fence) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        body.push(lines[i] ?? '')
        i += 1
      }
      blocks.push({ kind: 'code', lang: fence[1] ?? '', lines: body })
      continue
    }

    const next = (lines[i + 1] ?? '').trim()
    if (line.includes('|') && TABLE_DIVIDER.test(next)) {
      const header = splitRow(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && (lines[i] ?? '').trim().includes('|')) {
        rows.push(splitRow((lines[i] ?? '').trim()))
        i += 1
      }
      i -= 1
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      blocks.push({ kind: 'rule' })
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading?.[1] && heading[2]) {
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3
      blocks.push({ kind: 'heading', level, text: heading[2] })
      continue
    }

    if (line.startsWith('> ')) {
      blocks.push({ kind: 'quote', text: line.slice(2) })
      continue
    }

    if (/^[-*]\s+/.test(line)) {
      blocks.push({ kind: 'bullet', text: line.replace(/^[-*]\s+/, '') })
      continue
    }

    const numbered = /^(\d+)\.\s+(.*)$/.exec(line)
    if (numbered?.[1] && numbered[2] !== undefined) {
      blocks.push({ kind: 'numbered', marker: numbered[1], text: numbered[2] })
      continue
    }

    if (line === '') {
      blocks.push({ kind: 'blank' })
      continue
    }

    blocks.push({ kind: 'paragraph', text: line })
  }

  return blocks
}

/** Flattens inline markup to readable plain text. */
export function inlineToText(text: string): string {
  return parseInline(text)
    .map(part => (part.kind === 'link' ? `${part.text} (${part.href})` : part.text))
    .join('')
}
