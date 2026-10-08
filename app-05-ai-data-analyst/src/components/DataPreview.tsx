import type { ParsedData } from '../types'

const PREVIEW_ROWS = 10

export default function DataPreview({ data }: { data: ParsedData }) {
  const rows = data.rows.slice(0, PREVIEW_ROWS)

  return (
    <details className="ds-card app-preview">
      <summary className="app-preview__summary">Data preview</summary>
      <p className="ds-hint">
        First {rows.length} of {data.rows.length.toLocaleString()} rows.
      </p>
      <div className="app-table-wrap">
        <table className="app-table">
          <thead>
            <tr>
              {data.headers.map((header) => (
                <th key={header} scope="col">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {data.headers.map((header) => (
                  <td key={header}>{row[header] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
