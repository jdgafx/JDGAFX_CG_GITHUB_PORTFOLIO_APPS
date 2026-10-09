import type { ChangeEvent, RefObject } from 'react'
import type { DatasetState } from '../hooks/useLiveDataset'
import type { City } from '../lib/liveData/catalog'
import type { DatasetOption } from '../types'
import { useState } from 'react'
import DataSourcePanel from './DataSourcePanel'

interface DataSectionProps {
  options: DatasetOption[]
  selected: string
  /** Set only while the weather dataset is selected. */
  cities: City[] | null
  cityId: string
  state: DatasetState
  disabled: boolean
  fileInputRef: RefObject<HTMLInputElement | null>
  onSelect: (value: string) => void
  onCityChange: (cityId: string) => void
  onReload: () => void
  onUploadClick: () => void
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
}

/** The first controls section: choose live data or upload a file, then see what loaded. */
export default function DataSection({
  options,
  selected,
  cities,
  cityId,
  state,
  disabled,
  fileInputRef,
  onSelect,
  onCityChange,
  onReload,
  onUploadClick,
  onFileChange,
}: DataSectionProps) {
  // Below 1000 px the data card folds up so the question and the result stay near the top.
  const [open, setOpen] = useState<boolean>(() => window.matchMedia('(min-width: 1000px)').matches)
  const summary =
    state.status === 'ready'
      ? `${state.loaded.source.label}, ${state.loaded.data.rows.length.toLocaleString('en-US')} rows`
      : state.status === 'loading'
        ? 'Loading the data'
        : state.status === 'error'
          ? 'Could not load the data'
          : 'No data loaded'
  return (
    <details className="ds-disclosure app-data" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className="app-data__summary">
          <span className="ds-section__title">Your data</span>
          <span className="ds-help">{summary}</span>
        </span>
      </summary>
      <section className="ds-section" aria-label="Your data">

      <div className="ds-field">
        <label className="ds-label" htmlFor="dataset">Dataset</label>
        <select
          id="dataset"
          className="ds-select"
          value={selected}
          disabled={disabled}
          aria-describedby="dataset-help"
          onChange={(event) => onSelect(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p id="dataset-help" className="ds-help">
          The model only ever sees the column names and five sample rows.
        </p>
      </div>

      {cities && (
        <div className="ds-field">
          <label className="ds-label" htmlFor="city">City</label>
          <select
            id="city"
            className="ds-select"
            value={cityId}
            disabled={disabled}
            aria-describedby="city-help"
            onChange={(event) => onCityChange(event.target.value)}
          >
            {cities.map((city) => (
              <option key={city.id} value={city.id}>
                {city.label}
              </option>
            ))}
          </select>
          <p id="city-help" className="ds-help">Whose weather to load. Changing it fetches that city again.</p>
        </div>
      )}

      <DataSourcePanel state={state} disabled={disabled} onReload={onReload} />

      <div className="ds-field">
        <div className="ds-row">
          <button
            type="button"
            className="ds-button"
            disabled={disabled}
            aria-describedby="upload-help"
            onClick={onUploadClick}
          >
            Upload CSV
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          aria-label="Upload a CSV file"
          hidden
          onChange={onFileChange}
        />
        <p id="upload-help" className="ds-help">
          Your own CSV, up to 5 MB, with a header row. It is parsed in this browser.
        </p>
      </div>
      </section>
    </details>
  )
}
