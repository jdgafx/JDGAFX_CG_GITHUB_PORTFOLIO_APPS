import type { CSSProperties } from 'react'
import type { Branch, RunView } from '../lib/view'
import { fanText, loopText } from '../lib/status'
import { ChunkNode, PlaceholderChunk, StageNode } from './GraphNodes'

/*
 * Geometry in pixels. The node widths in app.css add up to CANVAS_W, and the loop is drawn from the centres below,
 * so change a width in app.css and the matching constant here together.
 */
const CANVAS_W = 710
const FAN_X = 192 // centre of the fan column
const CHECK_X = 576 // centre of the check node
const NODE_HALF = 28 // half the stage node height, which app.css sets to 56px
const SLOT = 36 // height reserved for one chunk in the fan
const MIN_FAN = 120 // a one-chunk fan is still tall enough to draw the loop

/** Vertical centre of chunk i in a fan of n, as a percentage of the fan's height. */
function centre(i: number, n: number): number {
  return ((i + 0.5) / n) * 100
}

function FanWire({ branches, count }: { branches: Branch[]; count: number }) {
  return (
    <li className="graph-wire graph-wire--fan" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {Array.from({ length: count }, (_, i) => {
          const taken = i < branches.length && branches[i].status !== 'idle'
          return <path key={i} d={`M0 50 L100 ${centre(i, count)}`} className={taken ? 'is-taken' : undefined} />
        })}
      </svg>
    </li>
  )
}

function ConvergeWire({ branches, count }: { branches: Branch[]; count: number }) {
  return (
    <li className="graph-wire graph-wire--converge" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {Array.from({ length: count }, (_, i) => {
          const taken = i < branches.length && branches[i].status === 'ok'
          return <path key={i} d={`M0 ${centre(i, count)} L100 50`} className={taken ? 'is-taken' : undefined} />
        })}
      </svg>
    </li>
  )
}

function Link({ taken }: { taken: boolean }) {
  return <li className={taken ? 'graph-link is-taken' : 'graph-link'} aria-hidden="true" />
}

export function GraphView({ view }: { view: RunView }) {
  const { branches, stages, retryLabel } = view
  const count = Math.max(branches.length, 1)
  const height = Math.max(count * SLOT, MIN_FAN)
  const fanTaken = stages.split !== 'idle'
  const loopTaken = retryLabel !== null
  const style = { '--h': `${height}px`, '--n': String(count) } as CSSProperties

  return (
    <section className="ds-section" aria-labelledby="graph-title">
      <div className="ds-section__head">
        <h2 id="graph-title" className="ds-section__title">
          Graph
        </h2>
        <p className="ds-section__sub">Each chunk is one extract call, and the calls run at the same time. A missed chunk loops back once.</p>
      </div>
      <div className="ds-panel graph-panel">
        <p className="graph-scroll-hint">Scroll the graph sideways to see every step.</p>
        <div className="ds-scroll-x">
          <div className="graph" style={style}>
            <p className={fanTaken ? 'graph-fan-label is-taken' : 'graph-fan-label'}>{fanText(view)}</p>
            <ol className="graph-row" aria-label="Graph steps in run order">
              <StageNode name="split" status={stages.split} />
              <FanWire branches={branches} count={count} />
              <li className="graph-fan">
                <ul className="graph-fan__list" aria-label="Extract branches">
                  {branches.length === 0 ? (
                    <PlaceholderChunk />
                  ) : (
                    branches.map((b) => <ChunkNode key={b.chunk} branch={b} />)
                  )}
                </ul>
              </li>
              <ConvergeWire branches={branches} count={count} />
              <StageNode name="reduce" status={stages.reduce} />
              <Link taken={stages.synthesize !== 'idle'} />
              <StageNode name="synthesize" status={stages.synthesize} />
              <Link taken={stages.check !== 'idle'} />
              <StageNode name="check" status={stages.check} />
              <Link taken={stages.final !== 'idle'} />
              <StageNode name="final" status={stages.final} />
            </ol>
            <svg
              className={loopTaken ? 'graph-loop is-taken' : 'graph-loop'}
              width={CANVAS_W}
              height={height + 70}
              viewBox={`0 0 ${CANVAS_W} ${height + 70}`}
              aria-hidden="true"
            >
              <path d={`M${CHECK_X} ${height / 2 + NODE_HALF} V${height + 18} H${FAN_X} V${height}`} />
            </svg>
            <p className={loopTaken ? 'graph-loop-label is-taken' : 'graph-loop-label'}>{loopText(view)}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
