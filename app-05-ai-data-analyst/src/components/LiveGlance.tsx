import type { Glance } from '../lib/liveGlance'
import type { DataSourceInfo } from '../types'
import { clock } from '../lib/liveData/indicator'
import ChartSvg from './ChartSvg'
import { useWidth } from './ChartFrame'

const exact = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 })
const identity = (text: string) => text

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-10-07" as "Oct 7". */
const dayName = (label: string) => `${MONTHS[Number(label.slice(5, 7)) - 1] ?? ''} ${Number(label.slice(8, 10))}`

interface LiveGlanceProps {
  glance: Glance
  source: DataSourceInfo
}

/** The live feed drawn at once on load: earthquakes per day, counted in this browser from the rows just fetched. No model call. */
export default function LiveGlance({ glance, source }: LiveGlanceProps) {
  const [holder, width] = useWidth()
  const labels = glance.days.map((day) => dayName(day.label))
  const values = glance.days.map((day) => day.count)
  const summary = `Bar chart of earthquakes per day, ${glance.days.length} days, ${exact(glance.total)} in all. The busiest day was ${glance.busiest.label}, with ${exact(glance.busiest.count)}.`
  return (
    <section className="ds-run__stage app-glance" aria-labelledby="glance-title">
      <div className="app-glance__head">
        <h2 id="glance-title" className="app-glance__title">Earthquakes per day</h2>
        <p className="ds-help">
          Live from {source.provider}, fetched {clock(source.fetchedAt)}. Counted in this browser from the rows below; no model was used.
        </p>
      </div>
      <dl className="app-glance__stats">
        <div>
          <dt>Earthquakes</dt>
          <dd className="ds-num">{exact(glance.total)}</dd>
        </div>
        <div>
          <dt>Strongest</dt>
          <dd className="ds-num app-glance__hi">{glance.strongest ? `M ${exact(glance.strongest.mag)}` : 'none'}</dd>
          {glance.strongest && <dd className="app-glance__sub">{glance.strongest.place}</dd>}
        </div>
        <div>
          <dt>Busiest day (UTC)</dt>
          <dd className="ds-num">{exact(glance.busiest.count)}</dd>
          <dd className="app-glance__sub">{dayName(glance.busiest.label)}</dd>
        </div>
        <div>
          <dt>Latest</dt>
          <dd className="ds-num">{glance.latest.slice(11, 16)}</dd>
          <dd className="app-glance__sub">{glance.latest.slice(0, 10)} UTC</dd>
        </div>
      </dl>
      <div ref={holder} className="app-chart__holder">
        {width > 0 && (
          <ChartSvg
            chartType="bar"
            labels={labels}
            values={values}
            measure="Earthquakes"
            axisUnit="earthquakes"
            months={false}
            display={identity}
            withUnit={identity}
            width={Math.max(280, width)}
            onSvg={() => {}}
            summary={summary}
          />
        )}
      </div>
      <p className="ds-help">
        The first and last day are partial: the feed is a rolling window.
      </p>
    </section>
  )
}
