import type { ParsedData } from '../types'

const PREVIEW_ROWS = 10

export default function DataPreview({ data }: { data: ParsedData }) {
  const rows = data.rows.slice(0, PREVIEW_ROWS)

  return (
    <details className="app-preview">
      <summary className="app-preview__summary">Data preview</summary>
      <p className="ds-section__sub">
        First {rows.length} of {data.rows.length.toLocaleString()} rows. The plan runs over every row, not only these.
      </p>
      <div className="ds-panel app-table-wrap">
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
