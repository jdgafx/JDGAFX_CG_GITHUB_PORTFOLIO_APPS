export type ModelMarker = 'match' | 'mismatch' | 'unchecked' | 'not-reported'
export type ModelOutcome = 'ok' | 'partial' | 'all-failed'

const SEVERITY: Record<ModelMarker, number> = { match: 0, unchecked: 1, 'not-reported': 2, mismatch: 3 }

/** match, mismatch ("not newest"), unchecked (no newest id to compare) or not-reported (the call named no model). */
export function markerFor(served: string | null, newest: string | null): ModelMarker {
  if (served === null || served === '') return 'not-reported'
  if (newest === null || newest === '') return 'unchecked'
  return served === newest ? 'match' : 'mismatch'
}

export function worstMarker(markers: ModelMarker[]): ModelMarker {
  return markers.reduce<ModelMarker>((worst, m) => (SEVERITY[m] > SEVERITY[worst] ? m : worst), 'match')
}

const SUFFIX: Record<ModelMarker, string> = { match: '', mismatch: ' · not newest', unchecked: ' · unchecked', 'not-reported': '' }

interface ModelChipProps {
  outcome: ModelOutcome
  /** The served model id of the call the marker comes from, or null when none was reported. */
  model: string | null
  marker: ModelMarker
}

/** The readout's model chip. The full id is in the title; the text drops the vendor prefix. */
export default function ModelChip({ outcome, model, marker }: ModelChipProps) {
  if (outcome === 'all-failed') {
    return (
      <span className="ds-chip ds-chip--wrap ds-chip--remove model-chip" title="Every explanation call failed">
        model · unavailable
      </span>
    )
  }
  const short = model ? model.replace(/^[^/]+\//, '') : 'model · not reported'
  const clean = marker === 'match' && outcome === 'ok'
  return (
    <span className={`ds-chip ds-chip--wrap model-chip${clean ? '' : ' ds-chip--change'}`} title={model ?? 'The call did not report a model id'}>
      {short}
      {SUFFIX[marker]}
      {outcome === 'partial' ? ' · partial' : ''}
    </span>
  )
}
