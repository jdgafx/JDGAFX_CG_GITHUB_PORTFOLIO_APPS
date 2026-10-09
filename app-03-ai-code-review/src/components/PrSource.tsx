import type { ReactNode } from 'react'
import { PR_SUGGESTIONS } from '../constants'
import { count } from '../lib/format'
import { fetchPullRequest, parsePrRef, type PullRequest } from '../lib/pullrequest'
import { SourceLoader, type Suggestion } from './SourceLoader'

const SUGGESTIONS: Suggestion[] = PR_SUGGESTIONS.flatMap(({ link, blurb }) => {
  const parsed = parsePrRef(link)
  return parsed.ok ? [{ link, blurb, title: `${parsed.value.owner}/${parsed.value.repo}#${parsed.value.number}`, meta: 'Merged, so the diff stays the same' }] : []
})

const STATE_CHIP = { open: 'ds-chip ds-chip--add', merged: 'ds-chip ds-chip--change', closed: 'ds-chip ds-chip--remove' } as const

interface PrSourceProps {
  pr: PullRequest | null
  disabled: boolean
  onLoaded: (pr: PullRequest) => void
  collapseKey: number
  children: ReactNode
}

export function PrSource({ pr, disabled, onLoaded, collapseKey, children }: PrSourceProps) {
  return (
    <SourceLoader
      collapseKey={collapseKey}
      id="pr"
      label="Public pull request"
      placeholder="github.com/owner/repo/pull/123"
      help="Paste a pull request link or owner/repo#123. Its diff is fetched in your browser from api.github.com (2 requests of GitHub's 60 an hour)."
      action="Load pull request"
      examplesLabel="Real pull requests to try"
      parse={parsePrRef}
      load={fetchPullRequest}
      onLoaded={(loaded) => {
        onLoaded(loaded)
        return null
      }}
      suggestions={SUGGESTIONS}
      disabled={disabled}
      scope={pr}
      loaded={
        pr && (
          <section className="ds-section" aria-label="Loaded pull request">
            <p className="pr-title">{pr.title}</p>
            <div className="ds-chips">
              <span className={STATE_CHIP[pr.state]}>{pr.draft ? 'draft' : pr.state}</span>
              <span className="ds-chip ds-chip--muted">{`${count(pr.changedFiles)} files`}</span>
              <span className="ds-chip ds-chip--add">{count(pr.additions)}</span>
              <span className="ds-chip ds-chip--remove">{count(pr.deletions)}</span>
            </div>
            <a className="source-link" href={pr.url} target="_blank" rel="noopener noreferrer">
              Open on GitHub
            </a>
          </section>
        )
      }
    >
      {children}
    </SourceLoader>
  )
}
