import { createContext, useContext, type ReactNode } from 'react'
import { sentencePieces } from '../lib/audit'
import { parseBlocks, type Block } from '../lib/blocks'
import { parseInline } from '../lib/markdown'
import { sentenceCase } from '../lib/titles'
import { VERDICT_VIEW } from '../lib/verdict'
import type { AuditClaim, Source } from '../types'
import { VerdictBadge } from './VerdictMark'

/** The run's sources, so a [n] marker in a stage's text links to source n. */
const SourcesContext = createContext<Source[]>([])

/** The report's audit: claims by where they sit, and which one is selected. */
interface ClaimsValue {
  byPlace: Map<string, AuditClaim>
  selected: number | null
  onSelect: (id: number) => void
}
const ClaimsContext = createContext<ClaimsValue | null>(null)

/**
 * Words that keep their capitals in a heading: names the retrieved sources carry (Rust, Everest, Berners-Lee), meaning
 * words that start with a capital in a source title and are never written in lower case anywhere in the sources.
 */
const namesOf = (sources: Source[]) => {
  const text = sources.map(source => `${source.title} ${source.snippet}`).join(' ')
  // A Hacker News snippet quotes its story title, so that title is dropped before looking for capitals inside sentences.
  const snippets = sources.map(source => (source.site === 'Hacker News' ? source.snippet.split(source.title).join(' ') : source.snippet))
  // A capital in a snippet mid-sentence ("On the Eiffel Tower, ...") marks a name. A title's first word is capitalised whatever it is ("Did", "History"), so it needs that proof.
  const inSentences = snippets.flatMap(snippet => [...snippet.matchAll(/(?<=[^.!?\s]\s+)(\p{Lu}[\p{L}\p{N}-]+)/gu)].map(match => match[1] ?? ''))
  // A Hacker News title is Title Case whatever it says, so only a Wikipedia title's capitals (Eiffel Tower, Mount Everest) name something.
  const inTitles = sources
    .filter(source => source.site !== 'Hacker News')
    .flatMap(source => [...source.title.matchAll(/\p{Lu}[\p{L}\p{N}-]+/gu)].filter(match => match.index > 0).map(match => match[0]))
  // A capital inside a sentence is a name only if the word is never written in lower case in the sources ("Stock Exchange" does not make "stock market" a name).
  const named = inSentences.filter(word => !text.includes(word.toLowerCase()) || inTitles.includes(word))
  return [...named, ...inTitles]
}

const CITATION = /(\[\d{1,3}\])/

/** Plain text in which a [n] that matches a retrieved source becomes a link to it (outside a claim, where links are allowed). */
function CitedText({ text, link }: { text: string; link: boolean }) {
  const sources = useContext(SourcesContext)
  return (
    <>
      {text.split(CITATION).map((piece, i) => {
        if (!CITATION.test(piece)) return piece
        const source = sources.find(candidate => `[${candidate.n}]` === piece)
        if (!source) return piece
        return link ? (
          <a key={i} className="md-cite" href={source.url} target="_blank" rel="noreferrer noopener" title={`${source.site}: ${source.title}`}>
            {piece}
          </a>
        ) : (
          <span key={i} className="md-cite" title={`${source.site}: ${source.title}`}>
            {piece}
          </span>
        )
      })}
    </>
  )
}

/** Model prose through the shared parser: strong, emphasis and code become elements, nothing else is interpreted. */
function InlineText({ text, link = true }: { text: string; link?: boolean }) {
  return (
    <>
      {parseInline(text).map((part, i) => {
        if (part.kind === 'strong') return <strong key={i}>{part.text}</strong>
        if (part.kind === 'em') return <em key={i}>{part.text}</em>
        if (part.kind === 'code') return <code key={i}>{part.text}</code>
        return <CitedText key={i} text={part.text} link={link} />
      })}
    </>
  )
}

function Claim({ claim, text }: { claim: AuditClaim; text: string }) {
  const value = useContext(ClaimsContext)
  const selected = value?.selected === claim.id
  const select = () => value?.onSelect(claim.id)
  const trimmed = text.trim()
  const cut = trimmed.lastIndexOf(' ') + 1
  const head = trimmed.slice(0, cut)
  const tail = trimmed.slice(cut)
  return (
    <span
      className="claim"
      data-verdict={claim.verdict}
      data-selected={selected ? 'true' : undefined}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Claim ${claim.id}, ${VERDICT_VIEW[claim.verdict].word}. ${text.replace(/\s*\[\d+(?:\s*[,;]\s*\d+)*\]/g, '').trim().replace(/([.!?])\.$/, '$1')} Opens its source.`}
      onClick={select}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          select()
        }
      }}
    >
      <InlineText text={head} link={false} />
      {/* The last word and the badge never break apart, so a badge is not left alone at the start of a line. */}
      <span className="claim__tail">
        <InlineText text={tail} link={false} />
        <VerdictBadge verdict={claim.verdict} short />
      </span>
    </span>
  )
}

/** A block's text cut into sentences, each shown as a claim when the audit has one for that place. */
function Sentences({ text, block }: { text: string; block: number }) {
  const value = useContext(ClaimsContext)
  if (!value) return <InlineText text={text} />
  return (
    <>
      {sentencePieces(text).map((piece, i) => {
        const claim = value.byPlace.get(`${block}:${i}`)
        return claim ? (
          <span key={i}>
            <Claim claim={claim} text={piece} />{' '}
          </span>
        ) : (
          <InlineText key={i} text={piece} />
        )
      })}
    </>
  )
}

function BlockView({ block, index }: { block: Block; index: number }) {
  const keep = namesOf(useContext(SourcesContext))
  switch (block.kind) {
    case 'heading': {
      const Tag = block.level === 1 ? 'h3' : block.level === 2 ? 'h4' : 'h5'
      return (
        <Tag>
          <InlineText text={sentenceCase(block.text, keep)} />
        </Tag>
      )
    }
    case 'quote':
      return (
        <blockquote>
          <Sentences text={block.text} block={index} />
        </blockquote>
      )
    case 'code':
      return (
        <pre>
          <code>{block.lines.join('\n')}</code>
        </pre>
      )
    case 'table':
      return (
        <div className="md-table">
          <table>
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i}>
                    <InlineText text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>
                      <InlineText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'rule':
      return <hr />
    case 'paragraph':
      return (
        <p>
          <Sentences text={block.text} block={index} />
        </p>
      )
    default:
      return null
  }
}

/** Consecutive bullets (or numbers) become one list, so the markup matches the text. */
function Blocks({ blocks }: { blocks: Block[] }) {
  const out: ReactNode[] = []
  let items: ReactNode[] = []
  let listKind: 'bullet' | 'numbered' | null = null

  const flush = () => {
    if (listKind === 'bullet') out.push(<ul key={out.length}>{items}</ul>)
    if (listKind === 'numbered') out.push(<ol key={out.length}>{items}</ol>)
    items = []
    listKind = null
  }

  blocks.forEach((block, i) => {
    if (block.kind === 'bullet' || block.kind === 'numbered') {
      if (listKind !== block.kind) flush()
      listKind = block.kind
      items.push(
        <li key={i}>
          <Sentences text={block.text} block={i} />
        </li>,
      )
      return
    }
    flush()
    out.push(<BlockView key={i} block={block} index={i} />)
  })
  flush()

  return <>{out}</>
}

interface MarkdownProps {
  text: string
  sources?: Source[]
  /** With claims, each cited sentence is a button carrying its verdict. The text must be the report body the claims were read from. */
  audit?: { claims: AuditClaim[]; selected: number | null; onSelect: (id: number) => void }
}

export function Markdown({ text, sources = [], audit }: MarkdownProps) {
  const claims: ClaimsValue | null = audit
    ? { byPlace: new Map(audit.claims.map(claim => [`${claim.block}:${claim.piece}`, claim])), selected: audit.selected, onSelect: audit.onSelect }
    : null
  return (
    <SourcesContext.Provider value={sources}>
      <ClaimsContext.Provider value={claims}>
        <div className="md">
          <Blocks blocks={parseBlocks(text)} />
        </div>
      </ClaimsContext.Provider>
    </SourcesContext.Provider>
  )
}
