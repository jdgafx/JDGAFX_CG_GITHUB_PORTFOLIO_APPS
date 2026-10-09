import { MODEL, type CatalogueResponse, type ModelGroup, type ModelOption } from '../../netlify/shared/contract'
import { formatPrice } from '../lib/format'

export type Picks = Record<'B' | 'C', string>

// Plain-language reasons for the picker's groups. The server sends each group's label and its models.
const GROUP_REASONS: Partial<Record<string, string>> = {
  'Speed and latency': 'Small models that answer quickly and cost little.',
  Reasoning: 'Models built to work through multi-step problems before they answer.',
  'Agentic and coding': 'Models that call tools and write code for agent-style tasks.',
  'Price and value': 'Capable models with a low price per token.',
  'Frontier quality': 'Top general models, chosen for answer quality rather than price.',
  'All other live text models': 'Other text models from the live list, with at least 32,000 tokens of context.',
}

// A group label this page does not know still gets a sentence.
const UNKNOWN_GROUP = 'A text model from the model list.'

interface PanelSetupProps {
  catalogue: CatalogueResponse | null
  catalogueFailed: boolean
  picks: Picks
  onPick: (slot: 'B' | 'C', id: string) => void
  disabled: boolean
}

export function PanelSetup({ catalogue, catalogueFailed, picks, onPick, disabled }: PanelSetupProps) {
  const groups = catalogue?.groups ?? []
  const placeholder = catalogueFailed ? 'Model list unavailable' : catalogue ? 'No models listed' : 'Loading models'
  return (
    <section className="ds-section" aria-labelledby="models-title">
      <div className="ds-section__head">
        <h2 className="ds-section__title" id="models-title">Models</h2>
        <p className="ds-section__sub">Panel A stays on the Haiku alias. Pick B and C to compare it against.</p>
      </div>
      <div className="ds-stack">
        <div className="ds-field">
          <span className="ds-label">Panel A model</span>
          <p className="arena-fixed" aria-describedby="fixed-help">
            {MODEL}
          </p>
          <p className="ds-help" id="fixed-help">
            Fixed for every run, so each comparison includes the same Haiku alias.
          </p>
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

// The category's reason, then this model's note and price. Each sentence starts with a capital and ends once.
function pickerHelp(group: ModelGroup, option: ModelOption): string {
  const note = option.why || option.label
  const sentence = note.charAt(0).toUpperCase() + note.slice(1)
  return `${GROUP_REASONS[group.label] ?? UNKNOWN_GROUP} ${sentence}. ${formatPrice(option.inPerM, option.outPerM)}.`
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
  const helpId = `${id}-help`
  const group = groups.find(g => g.options.some(option => option.id === value))
  const selected = group?.options.find(option => option.id === value)
  const empty = groups.length === 0
  return (
    <div className="ds-field">
      <label className="ds-label" htmlFor={id}>
        Panel {slot} model
      </label>
      <select
        id={id}
        className="ds-select"
        value={empty ? '' : value}
        disabled={disabled || empty}
        onChange={e => onChange(e.target.value)}
        aria-describedby={helpId}
      >
        {empty && <option value="">{placeholder}</option>}
        {groups.map(g => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map(option => (
              <option key={option.id} value={option.id}>
                {optionText(option)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="ds-help" id={helpId}>
        {group && selected ? pickerHelp(group, selected) : placeholder}
      </p>
    </div>
  )
}
