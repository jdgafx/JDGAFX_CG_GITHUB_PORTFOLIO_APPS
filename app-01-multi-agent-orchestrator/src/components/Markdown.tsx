import type { ReactNode } from 'react'
import { parseBlocks, parseInline, type Block } from '../lib/markdown'

function Inline({ text }: { text: string }): ReactNode {
  return parseInline(text).map((part, i) => {
    switch (part.kind) {
      case 'bold':
        return (
          <strong key={i} style={{ color: '#f1f5f9', fontWeight: 700 }}>
            {part.text}
          </strong>
        )
      case 'italic':
        return (
          <em key={i} style={{ color: '#e2e8f0' }}>
            {part.text}
          </em>
        )
      case 'code':
        return (
          <code
            key={i}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.88em',
              padding: '1px 5px',
              borderRadius: 5,
              background: 'rgba(255,255,255,0.07)',
              color: '#e2e8f0',
            }}
          >
            {part.text}
          </code>
        )
      case 'link':
        return (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noreferrer noopener"
            title={part.href}
            style={{ color: '#00d4ff', textDecoration: 'underline', textUnderlineOffset: 2 }}
          >
            {part.text}
          </a>
        )
      default:
        return <span key={i}>{part.text}</span>
    }
  })
}

function BlockView({ block, accent }: { block: Block; accent: string }): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const styles = {
        1: { fontSize: 19, fontWeight: 800, color: '#f1f5f9', marginTop: 20, marginBottom: 10 },
        2: {
          fontSize: 17,
          fontWeight: 700,
          color: '#f1f5f9',
          marginTop: 20,
          marginBottom: 8,
          borderBottom: `1px solid ${accent}33`,
          paddingBottom: 6,
        },
        3: { fontSize: 15, fontWeight: 700, color: accent, marginTop: 16, marginBottom: 6 },
      } as const
      return <div style={styles[block.level]}>{<Inline text={block.text} />}</div>
    }
    case 'bullet':
      return (
        <div style={{ paddingLeft: 16, position: 'relative', marginBottom: 4 }}>
          <span style={{ position: 'absolute', left: 2, color: accent }}>•</span>
          <Inline text={block.text} />
        </div>
      )
    case 'numbered':
      return (
        <div style={{ paddingLeft: 20, position: 'relative', marginBottom: 4 }}>
          <span style={{ position: 'absolute', left: 0, color: accent, fontWeight: 700, fontSize: 12 }}>
            {block.marker}.
          </span>
          <Inline text={block.text} />
        </div>
      )
    case 'quote':
      return (
        <div
          style={{
            borderLeft: `3px solid ${accent}66`,
            paddingLeft: 12,
            margin: '6px 0',
            color: '#94a3b8',
            fontStyle: 'italic',
          }}
        >
          <Inline text={block.text} />
        </div>
      )
    case 'code':
      return (
        <pre
          style={{
            margin: '10px 0',
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.08)',
            overflowX: 'auto',
            fontFamily: 'var(--font-mono)',
            fontSize: 12.5,
            lineHeight: 1.6,
            color: '#e2e8f0',
          }}
        >
          <code>{block.lines.join('\n')}</code>
        </pre>
      )
    case 'table':
      return (
        <div style={{ overflowX: 'auto', margin: '10px 0' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: '100%' }}>
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th
                    key={i}
                    style={{
                      textAlign: 'left',
                      padding: '6px 10px',
                      color: accent,
                      fontWeight: 700,
                      borderBottom: `1px solid ${accent}55`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <Inline text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      style={{
                        padding: '6px 10px',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                        verticalAlign: 'top',
                      }}
                    >
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'rule':
      return <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '14px 0' }} />
    case 'blank':
      return <div style={{ height: 8 }} />
    default:
      return (
        <div style={{ marginBottom: 4 }}>
          <Inline text={block.text} />
        </div>
      )
  }
}

export function Markdown({ text, accent }: { text: string; accent: string }) {
  return (
    <>
      {parseBlocks(text).map((block, i) => (
        <BlockView key={i} block={block} accent={accent} />
      ))}
    </>
  )
}
