import { SEVERITY_CONFIG } from '../constants'
import { VERDICT_WORD } from '../lib/verdicts'
import type { ReviewComment } from '../types'
import { Inline } from './Inline'

/** Where a comment sits, in words: a line of the file, or a file and line of the pull request. */
export function placeOf(c: ReviewComment): string {
  if (!c.where) return `Line ${c.line}`
  return c.where.line === 0 ? c.where.file : `${c.where.file}:${c.where.line}`
}

/** The class that tints the cited line: the diff side for a pull request, the severity for a file. */
function lineClass(c: ReviewComment): string {
  if (c.where) {
    if (c.code.startsWith('+')) return 'ds-code__line ds-code__line--add'
    return c.code.startsWith('-') ? 'ds-code__line ds-code__line--del' : 'ds-code__line'
  }
  if (c.severity === 'critical') return 'ds-code__line ds-code__line--error'
  if (c.severity === 'warning') return 'ds-code__line ds-code__line--warn'
  return 'ds-code__line'
}

/** The cited line as the reviewer saw it. A diff line loses its leading + or -, which the gutter mark shows instead. */
function CitedCode({ c }: { c: ReviewComment }) {
  const blank = c.code.trim() === ''
  const text = c.where && /^[+\- ]/.test(c.code) ? c.code.slice(1) : c.code
  return (
    <div className="ds-code-wrap">
      <pre
        className="ds-code finding__code"
        tabIndex={0}
        role="region"
        aria-label={`Code at ${placeOf(c)}, scrolls sideways`}
        style={{ counterReset: `ds-line ${(c.where?.line ?? c.line) - 1}` }}
      >
        <span className={lineClass(c)}>{blank ? '(blank line)' : text.trimStart()}</span>
      </pre>
    </div>
  )
}

interface FindingProps {
  comment: ReviewComment
  active: boolean
  /** Shows the line in the editor. Absent for a pull request, which has no editor. */
  onShowLine?: () => void
}

/** One kept, moved or unconfirmed comment: the code it is about, what is wrong, the fix, and how it was verified. */
export function Finding({ comment: c, active, onShowLine }: FindingProps) {
  const verdict = VERDICT_WORD[c.verdict]
  const by = c.decidedBy === 'verifier' ? 'Second pass' : c.decidedBy === 'check' ? 'Checks' : null
  return (
    <li className={active ? 'finding is-active' : 'finding'} data-verdict={c.verdict}>
      <div className="finding__head">
        <span className="severity">
          <span className={`ds-dot dot--${c.severity}`} aria-hidden="true" />
          {SEVERITY_CONFIG[c.severity].label}
        </span>
        <span className="finding__place ds-mono">{placeOf(c)}</span>
        <span className={verdict.chip}>{verdict.word}</span>
        {c.verdict === 'moved' && (
          <span className="ds-help">{c.where ? `moved ${Math.abs(c.line - c.fromLine)} diff lines` : `from line ${c.fromLine}`}</span>
        )}
        {onShowLine && (
          <button type="button" className="ds-button ds-button--quiet finding__show" aria-pressed={active} title={`Show line ${c.line} in the editor`} onClick={onShowLine}>
            Show in editor
          </button>
        )}
      </div>
      <CitedCode c={c} />
      <p className="finding__message">
        <Inline text={c.message} />
      </p>
      <p className="finding__suggestion">
        <span className="finding__label">Suggestion </span>
        <Inline text={c.suggestion} />
      </p>
      <p className="finding__verify">
        <span className="finding__label">{by ? `${by}: ` : 'Verification: '}</span>
        {c.reason}
        {c.evidence && (
          <>
            {' '}
            <code className="finding__evidence">{c.evidence}</code>
          </>
        )}
      </p>
    </li>
  )
}
