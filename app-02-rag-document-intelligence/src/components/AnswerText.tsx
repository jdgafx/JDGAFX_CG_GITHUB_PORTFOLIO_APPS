import { Fragment, type ReactNode } from 'react'

interface Group {
  kind: 'p' | 'ul'
  lines: string[]
}

// Blank lines end a paragraph. "- " or "* " lines form a bullet list.
function groupLines(text: string): Group[] {
  const groups: Group[] = []
  let current: Group | null = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') {
      current = null
      continue
    }
    const bullet = /^[-*]\s+/.test(line)
    const kind = bullet ? 'ul' : 'p'
    if (!current || current.kind !== kind) {
      current = { kind, lines: [] }
      groups.push(current)
    }
    current.lines.push(bullet ? line.replace(/^[-*]\s+/, '') : line)
  }
  return groups
}

/** Only **bold** is styled. Everything else is shown as the model wrote it. */
function withBold(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  )
}

export function AnswerText({ text }: { text: string }) {
  return (
    <div className="docmind-answer">
      {groupLines(text).map((group, i) =>
        group.kind === 'ul' ? (
          <ul key={i}>
            {group.lines.map((line, j) => (
              <li key={j}>{withBold(line)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{withBold(group.lines.join(' '))}</p>
        ),
      )}
    </div>
  )
}
