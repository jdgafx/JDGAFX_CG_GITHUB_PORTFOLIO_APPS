import type { CatalogueResponse } from '../../netlify/shared/contract'

interface HeaderProps {
  catalogue: CatalogueResponse | null
  catalogueFailed: boolean
}

function catalogueBadge({ catalogue, catalogueFailed }: HeaderProps): { label: string; className: string } {
  if (catalogueFailed) return { label: 'Model list unavailable', className: 'ds-badge--danger' }
  if (!catalogue) return { label: 'Loading model list', className: '' }
  if (catalogue.source === 'live') return { label: 'Live model list', className: 'ds-badge--success' }
  if (catalogue.source === 'cached') return { label: 'Cached model list', className: 'ds-badge--warning' }
  return { label: 'Fallback model list', className: 'ds-badge--warning' }
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
        <span className={`ds-badge ${badge.className}`}>{badge.label}</span>
      </div>
    </header>
  )
}
