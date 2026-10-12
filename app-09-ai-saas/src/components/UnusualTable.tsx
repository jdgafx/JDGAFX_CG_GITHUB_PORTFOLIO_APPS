import { formatCount } from '../../shared/format'
import type { PackageFacts, UnusualRow } from '../../shared/types'
import { releaseWords } from '../lib/labels'

interface Row {
  key: string
  day: string
  dayTitle?: string
  pkg: string
  kind: string
  value: string
  base: string
  release: string
  releaseTitle?: string
}

/** A baseline is a median, so it may end in .5 (an even count of days). */
function formatBase(n: number): string {
  if (Number.isInteger(n)) return formatCount(n)
  const [whole = '0', fraction = '0'] = n.toFixed(1).split('.')
  return `${formatCount(whole)}.${fraction}`
}

function releaseCell(u: UnusualRow): { text: string; title?: string } {
  if (u.release === 'none') return { text: 'none' }
  if (u.release === 'unavailable') return { text: 'unavailable' }
  return { text: u.version ?? releaseWords(u.release), title: releaseWords(u.release) }
}

function rowsFor(f: PackageFacts): Row[] {
  const dated: Array<Row & { sort: string }> = [
    ...f.unusual.map(u => {
      const r = releaseCell(u)
      return { sort: u.day, key: `${f.name}:u:${u.day}`, day: u.day, pkg: f.name, kind: u.kind, value: formatCount(u.value), base: formatBase(u.median), release: r.text, releaseTitle: r.title }
    }),
    ...f.possibleGaps.map(d => ({ sort: d, key: `${f.name}:g:${d}`, day: d, pkg: f.name, kind: 'possible npm gap', value: '0', base: '—', release: '—' })),
  ].sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0))
  if (f.notAssessed.length > 0) {
    dated.push({
      sort: '~',
      key: `${f.name}:n`,
      day: `${f.notAssessed.length} days`,
      dayTitle: f.notAssessed.join(', '),
      pkg: f.name,
      kind: 'not assessed',
      value: '—',
      base: '—',
      release: '—',
    })
  }
  return dated
}

/** Every unusual day, every possible npm gap, and which days were too thin to assess, per package. */
export default function UnusualTable({ facts }: { facts: PackageFacts[] }) {
  const rows = facts.flatMap(rowsFor)
  const none = facts.every(f => f.unusual.length === 0 && f.possibleGaps.length === 0)
  return (
    <section className="unusual ds-card" aria-labelledby="unusual-title">
      <h2 id="unusual-title" className="ds-section__title">
        Unusual days
      </h2>
      {none && <p className="ds-hint">No unusual days in this window.</p>}
      {rows.length > 0 && (
        <div className="ds-scroll-x">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Package</th>
                <th scope="col">Kind</th>
                <th scope="col">Value</th>
                <th scope="col">Base</th>
                <th scope="col">Release</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key}>
                  <td className="ds-num" title={r.dayTitle}>{r.day}</td>
                  <td>{r.pkg}</td>
                  <td>{r.kind}</td>
                  <td className="ds-num">{r.value}</td>
                  <td className="ds-num">{r.base}</td>
                  <td className="ds-num" title={r.releaseTitle}>{r.release}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
