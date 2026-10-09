import type { PrFileAccount, PrAccount, SkipReason } from '../types'
import { count } from '../lib/format'
import type { PullRequest } from '../lib/pullrequest'

const REASON: Record<SkipReason, string> = {
  'no-patch': 'No text patch: GitHub sends none for binary files or very large diffs',
  generated: 'Lockfile or minified output, not reviewed',
  'too-large': 'Larger than the whole review limit',
  'not-selected': 'Not selected',
}

interface PrFilesProps {
  pr: PullRequest
  account: PrAccount
  selected: ReadonlySet<string>
  disabled: boolean
  onToggle: (path: string) => void
  /** Comments shown for each file after a review. */
  commentCounts: Readonly<Record<string, number>>
}

function FileRow({ file, selected, room, disabled, comments, onToggle }: { file: PrFileAccount; selected: boolean; room: number; disabled: boolean; comments: number | undefined; onToggle: () => void }) {
  const selectable = file.skipped === null || file.skipped === 'not-selected'
  const fits = selected || file.chars <= room
  const blocked = !selectable || !fits
  const why = !selectable ? REASON[file.skipped as SkipReason] : !fits ? 'Would pass the review limit: untick another file first' : null
  return (
    <li className="prfile">
      <label className={blocked ? 'prfile__label is-blocked' : 'prfile__label'}>
        <input type="checkbox" checked={selected} disabled={disabled || blocked} onChange={onToggle} />
        <span className="prfile__path ds-mono">{file.path}</span>
        <span className="prfile__meta">
          <span className="ds-chip ds-chip--muted">{file.status}</span>
          <span className="ds-num">{`${count(file.changed)} changed, ${count(file.chars)} chars`}</span>
          {comments !== undefined && <span className="ds-num prfile__comments">{`${count(comments)} ${comments === 1 ? 'comment' : 'comments'}`}</span>}
        </span>
        {why && <span className="prfile__why">{why}</span>}
      </label>
    </li>
  )
}

/** The pull request's files with what each one adds to the review. Nothing is left out without a reason on its row. */
export function PrFiles({ pr, account, selected, disabled, onToggle, commentCounts }: PrFilesProps) {
  const room = account.charLimit - account.charsIncluded
  const share = Math.min(100, (account.charsIncluded / account.charLimit) * 100)
  return (
    <section className="ds-card" aria-labelledby="prfiles-title">
      <div className="ds-card__head">
        <h2 id="prfiles-title" className="ds-section__title">
          Files in this review
        </h2>
        <span className="ds-hint">{`${pr.owner}/${pr.repo}#${pr.number}`}</span>
      </div>
      <p className="prfiles__line" role="status">
        <strong>{`${count(account.filesIncluded)} of ${count(account.filesTotal)} files`}</strong>
        {`, ${count(account.changedIncluded)} changed lines, ${count(account.charsIncluded)} of ${count(account.charLimit)} characters.`}
      </p>
      <div className="ds-hbar__track prfiles__bar" aria-hidden="true">
        <span className="ds-hbar__bar" style={{ ['--w' as string]: `${share}%` }} />
      </div>
      {pr.partial && (
        <p className="ds-notice ds-notice--warning" role="status">
          {`GitHub lists ${count(pr.files.length)} of this pull request's ${count(pr.changedFiles)} files in one page. The rest are not shown here and are not reviewed.`}
        </p>
      )}
      <ul className="prfiles">
        {account.files.map((file) => (
          <FileRow key={file.path} file={file} selected={selected.has(file.path)} room={room} disabled={disabled} comments={commentCounts[file.path]} onToggle={() => onToggle(file.path)} />
        ))}
      </ul>
      <p className="ds-help">
        A review reads whole files, never a cut piece. Files are selected in order until the limit is reached; tick another to swap.
      </p>
    </section>
  )
}
