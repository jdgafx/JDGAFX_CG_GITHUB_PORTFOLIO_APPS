import { useId, useState } from 'react'
import { SEVERITY_CONFIG } from '../constants'
import type { ContextLine } from '../lib/context'
import { splitAtQuote } from '../lib/quote'
import { VERDICT_WORD, verdictLabel } from '../lib/verdicts'
import type { ReviewComment } from '../types'
import { Inline } from './Inline'

/** Where a comment sits, in words: a line of the file, or a file and line of the pull request. */
export function placeOf(c: ReviewComment): string {
  if (!c.where) return `Line ${c.line}`
  return c.where.line === 0 ? c.where.file : `${c.where.file}:${c.where.line}`
}

/** The class that tints a line: the diff side in a pull request, the severity of the comment in a file. */
function lineClass(kind: ContextLine['kind'] | 'cited-file', c: ReviewComment, cited: boolean): string {
  if (kind === 'add') return 'ds-code__line ds-code__line--add'
  if (kind === 'del') return 'ds-code__line ds-code__line--del'
  if (kind === 'ctx' || !cited) return 'ds-code__line'
  if (c.severity === 'critical') return 'ds-code__line ds-code__line--error'
  return c.severity === 'warning' ? 'ds-code__line ds-code__line--warn' : 'ds-code__line'
}

/** The code the second pass relied on, drawn inside the cited line: an underline in the verdict's own style. */
function QuotedLine({ text, evidence, verdict }: { text: string; evidence: string | null; verdict: ReviewComment['verdict'] }) {
  const parts = splitAtQuote(text, evidence)
  if (!parts) return <>{text}</>
  return (
    <>
      {parts.before}
      <mark className={`finding__quote finding__quote--${verdict}`}>{parts.quote}</mark>
      {parts.after}
    </>
  )
}

interface CitedCodeProps {
  comment: ReviewComment
  /** The lines around the cited one, when the reader has opened the context. */
  context: ContextLine[] | null
}

/** The cited line, or the lines around it, with the number the reader knows (the file's own, not the numbered diff's). */
export function CitedCode({ comment: c, context }: CitedCodeProps) {
  const blank = c.code.trim() === ''
  const own = c.where && /^[+\- ]/.test(c.code) ? c.code.slice(1) : c.code
  const kind: ContextLine['kind'] = c.where ? (c.code.startsWith('+') ? 'add' : c.code.startsWith('-') ? 'del' : 'ctx') : 'code'
  const lines: ContextLine[] = context ?? [{ text: own, n: c.where ? (c.where.line > 0 ? String(c.where.line) : '') : String(c.line), kind, cited: true }]
  const quoteOnLine = lines.some((l) => l.cited && splitAtQuote(l.text.trimStart(), c.evidence))
  return (
    <div className="ds-code-wrap">
      <pre className="ds-code finding__code" tabIndex={0} role="region" aria-label={`Code at ${placeOf(c)}, scrolls sideways`}>
        {lines.map((l, i) => (
          <span key={i} className={lineClass(l.kind, c, l.cited)} data-n={l.n} data-cited={l.cited ? 'true' : undefined}>
            {l.cited && blank ? '(blank line)' : l.cited ? <QuotedLine text={l.text.trimStart()} evidence={c.evidence} verdict={c.verdict} /> : l.text.trimStart() || ' '}
          </span>
        ))}
        {c.evidence && !quoteOnLine && (
          <span className="ds-code__line finding__evline" data-n="" title="Quoted by the second pass">
            {c.evidence}
          </span>
        )}
      </pre>
    </div>
  )
}

/** The verdict as one line under the code: the badge, then the reason at reading size. */
export function VerdictLine({ comment: c }: { comment: ReviewComment }) {
  return (
    <p className="finding__verdict">
      <span className={VERDICT_WORD[c.verdict].badge}>
        <span className="ds-dot" aria-hidden="true" />
        {verdictLabel(c)}
      </span>
      <span className="finding__reason">{c.reason}</span>
    </p>
  )
}

interface FindingProps {
  comment: ReviewComment
  active: boolean
  /** The lines around the cited one, or null when the text is not held. */
  contextOf: (c: ReviewComment) => ContextLine[] | null
  /** The place on GitHub for a pull request comment. */
  href: string | null
  /** Shows the line in the editor. Absent for a pull request, which has no editor. */
  onShowLine?: () => void
}

/** One kept, moved or unconfirmed comment: severity and place, the code with its quote marked, the verdict, then the note. */
export function Finding({ comment: c, active, contextOf, href, onShowLine }: FindingProps) {
  const [open, setOpen] = useState(false)
  const contextId = useId()
  const context = open ? contextOf(c) : null
  const canExpand = contextOf(c) !== null
  const place = placeOf(c)
  return (
    <li id={`finding-${c.id}`} tabIndex={-1} className={active ? 'finding is-active' : 'finding'} data-verdict={c.verdict}>
      <div className="finding__head">
        <span className="severity">
          <span className={`ds-dot dot--${c.severity}`} aria-hidden="true" />
          {SEVERITY_CONFIG[c.severity].label}
        </span>
        {href ? (
          <a className="finding__place finding__place--link ds-mono" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${place}, opens on GitHub`}>
            {place}
          </a>
        ) : (
          <span className="finding__place ds-mono">{place}</span>
        )}
        <span className="finding__actions">
          {canExpand && (
            <button type="button" className="ds-button ds-button--quiet" aria-expanded={open} aria-controls={contextId} onClick={() => setOpen((v) => !v)}>
              {open ? 'Hide context' : 'Show context'}
            </button>
          )}
          {onShowLine && (
            <button type="button" id={`show-${c.id}`} className="ds-button ds-button--quiet" aria-pressed={active} title={`Show line ${c.line} in the editor`} onClick={onShowLine}>
              Show in editor
            </button>
          )}
        </span>
      </div>
      <div id={contextId}>
        <CitedCode comment={c} context={context} />
      </div>
      <VerdictLine comment={c} />
      {c.support && c.supportLine !== null && (
        <p className="finding__support">
          <span className="finding__label">{`Evidence, line ${c.supportLine}: `}</span>
          <code>{c.support}</code>
        </p>
      )}
      <p className="finding__message">
        <Inline text={c.message} />
      </p>
      <p className="finding__suggestion">
        <span className="finding__label">Suggestion </span>
        <Inline text={c.suggestion} />
      </p>
    </li>
  )
}
