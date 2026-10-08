import { MODEL, type CatalogueResponse, type ModelGroup, type ModelOption } from '../../netlify/shared/contract'
import { formatPrice } from '../lib/format'

export type Picks = Record<'B' | 'C', string>

interface PanelSetupProps {
  catalogue: CatalogueResponse | null
  catalogueFailed: boolean
  picks: Picks
  onPick: (slot: 'B' | 'C', id: string) => void
  disabled: boolean
}

export function PanelSetup({ catalogue, catalogueFailed, picks, onPick, disabled }: PanelSetupProps) {
  const groups = catalogue?.groups ?? []
  const placeholder = catalogueFailed ? 'Model list unavailable' : 'Loading models'
  return (
    <section className="ds-card" aria-labelledby="models-title">
      <div className="ds-card__head">
        <h2 className="ds-card__title" id="models-title">Models</h2>
        <span className="ds-hint">Panel A is fixed. Choose B and C from the list.</span>
      </div>
      <div className="arena-setup">
        <div className="ds-field">
          <span className="ds-label">Panel A</span>
          <span className="ds-badge ds-badge--accent ds-mono arena-fixed">{MODEL}</span>
          <span className="ds-hint">Fixed for every run.</span>
        </div>
        <ModelPicker
          slot="B"
          value={picks.B}
          groups={groups}
          placeholder={placeholder}
          disabled={disabled}
          onChange={id => onPick('B', id)}
        />
        <ModelPicker
          slot="C"
          value={picks.C}
          groups={groups}
          placeholder={placeholder}
          disabled={disabled}
          onChange={id => onPick('C', id)}
        />
      </div>
    </section>
  )
}

function optionText(option: ModelOption): string {
  return `${option.id}: ${option.why || option.label}. ${formatPrice(option.inPerM, option.outPerM)}`
}

interface ModelPickerProps {
  slot: 'B' | 'C'
  value: string
  groups: ModelGroup[]
  placeholder: string
  disabled: boolean
  onChange: (id: string) => void
}

function ModelPicker({ slot, value, groups, placeholder, disabled, onChange }: ModelPickerProps) {
  const id = `pick-${slot}`
  const selected = groups.flatMap(group => group.options).find(option => option.id === value)
  const empty = groups.length === 0
  return (
    <div className="ds-field">
      <label className="ds-label" htmlFor={id}>Panel {slot} model</label>
      <select
        id={id}
        className="ds-select"
        value={empty ? '' : value}
        disabled={disabled || empty}
        onChange={e => onChange(e.target.value)}
        aria-describedby={`${id}-why`}
      >
        {empty && <option value="">{placeholder}</option>}
        {groups.map(group => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map(option => (
              <option key={option.id} value={option.id}>
                {optionText(option)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="ds-hint" id={`${id}-why`}>
        {selected ? `${selected.why || selected.label}. ${formatPrice(selected.inPerM, selected.outPerM)}.` : placeholder}
      </p>
    </div>
  )
}
