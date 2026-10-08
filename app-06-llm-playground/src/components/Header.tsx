import type { CatalogueResponse } from '../../netlify/shared/contract'

interface HeaderProps {
  catalogue: CatalogueResponse | null
  catalogueFailed: boolean
}

interface CatalogueBadge {
  label: string
  dot: string
}

function catalogueBadge({ catalogue, catalogueFailed }: HeaderProps): CatalogueBadge {
  if (catalogueFailed) return { label: 'Model list unavailable', dot: 'ds-dot--failed' }
  if (!catalogue) return { label: 'Loading model list', dot: '' }
  if (catalogue.source === 'live') return { label: 'Live model list', dot: 'ds-dot--ok' }
  if (catalogue.source === 'cached') return { label: 'Cached model list', dot: 'arena-dot--warn' }
  return { label: 'Fallback model list', dot: 'arena-dot--warn' }
}

export function Header(props: HeaderProps) {
  const badge = catalogueBadge(props)
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div>
          <h1 className="ds-title">ModelArena</h1>
          <p className="ds-subtitle">Send one prompt to three models and compare the measured results.</p>
        </div>
        <span className="ds-badge">
          <span className={`ds-dot ${badge.dot}`} aria-hidden="true" />
          {badge.label}
        </span>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> the same prompt measured on three models at once, with cost from the
          provider's usage and an AI judge's note labelled as opinion.
        </p>
      </div>
    </header>
  )
}
