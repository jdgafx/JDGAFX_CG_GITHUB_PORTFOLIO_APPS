import type { IssueRef } from '../types'

/** The issue the graph below is working on, with a link to its GitHub page. */
export function IssueBanner({ issue }: { issue: IssueRef }) {
  return (
    <p className="gg-banner">
      <span className="gg-banner__repo">
        {issue.repo} #{issue.number}
      </span>
      <span className="gg-banner__title">{issue.title}</span>
      {issue.htmlUrl.startsWith('https://github.com/') ? (
        <a href={issue.htmlUrl} target="_blank" rel="noopener noreferrer">
          Open on GitHub
        </a>
      ) : null}
    </p>
  )
}
