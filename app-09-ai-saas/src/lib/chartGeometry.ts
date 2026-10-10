/** Pure geometry for the line charts: scales, ticks, line paths with breaks, and end-label spacing. */

export interface Axis {
  /** Maps a data value to a y pixel. Values the scale cannot place (zero on a log axis) give null. */
  y: (value: number) => number | null
  ticks: number[]
  /** True for a log axis. */
  log: boolean
}

/** The nicest step of 1, 2 or 5 times a power of ten that fits `count` steps into `max`. */
function niceStep(max: number, count: number): number {
  const raw = max / count
  const power = 10 ** Math.floor(Math.log10(raw))
  const unit = raw / power
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power
}

/** A linear axis from zero to a round maximum, with up to `count` steps. */
export function linearAxis(max: number, top: number, bottom: number, count = 4): Axis {
  if (!(max > 0)) return { y: () => bottom, ticks: [0], log: false }
  const step = niceStep(max, count)
  const ceiling = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= ceiling + step / 2; v += step) ticks.push(v)
  return { y: (value) => bottom - (value / ceiling) * (bottom - top), ticks, log: false }
}

/** A log axis between two powers of ten, as logDomain returns them, with a tick at each power. */
export function logAxis(domain: [number, number], top: number, bottom: number): Axis {
  const [lo, hi] = domain
  const span = Math.log10(hi) - Math.log10(lo) || 1
  const ticks: number[] = []
  for (let v = lo; v <= hi * 1.001; v *= 10) ticks.push(v)
  return {
    y: (value) => (value > 0 ? bottom - ((Math.log10(value) - Math.log10(lo)) / span) * (bottom - top) : null),
    ticks,
    log: true,
  }
}

/**
 * An SVG path through the points, broken wherever a value is missing so an unreported day shows as a gap.
 * A lone point between two gaps is drawn as a zero-length segment, which a round line cap shows as a dot.
 */
export function linePath(xs: number[], values: (number | null)[], axis: Axis): string {
  let path = ''
  let open = false
  values.forEach((value, i) => {
    const y = value === null ? null : axis.y(value)
    if (y === null) {
      open = false
      return
    }
    const x = xs[i].toFixed(1)
    path += `${open ? 'L' : 'M'}${x} ${y.toFixed(1)}`
    if (!open && !(i + 1 < values.length && values[i + 1] !== null)) path += `L${x} ${y.toFixed(1)}`
    open = true
  })
  return path
}

/**
 * Keeps end labels at least `gap` pixels apart. Labels are given in any order with the y they want and come back
 * with the y they get: the upper one stays, the lower one moves down. `moved` marks the labels that need a leader.
 */
export function spreadLabels(wanted: number[], gap = 14): { y: number; moved: boolean }[] {
  const order = [...wanted.keys()].sort((a, b) => wanted[a] - wanted[b])
  const placed: { y: number; moved: boolean }[] = wanted.map((y) => ({ y, moved: false }))
  let previous = -Infinity
  for (const i of order) {
    const y = Math.max(wanted[i], previous + gap)
    placed[i] = { y, moved: y !== wanted[i] }
    previous = y
  }
  return placed
}

/** The indices of evenly spaced items that keep at least `minPx` between labels, counting back from the last item. */
export function tickIndices(count: number, width: number, minPx: number): number[] {
  if (count <= 1) return [0]
  const fit = Math.max(1, Math.floor(width / minPx))
  const every = Math.max(1, Math.ceil((count - 1) / fit))
  const indices: number[] = []
  for (let i = count - 1; i >= 0; i -= every) indices.unshift(i)
  return indices
}

/**
 * The key of the marker nearest to a tap, or null when none is within `radius` pixels. On a long window markers sit a pixel
 * or less apart, so a tap on one must not fall to its neighbour's tap area: the nearest to the finger wins, and a tie goes to
 * the earlier one.
 */
export function nearestMark(marks: { x: number; y: number; key: string }[], px: number, py: number, radius: number): string | null {
  let best: { key: string; d: number } | null = null
  for (const m of marks) {
    const d = Math.hypot(m.x - px, m.y - py)
    if (d <= radius && (best === null || d < best.d)) best = { key: m.key, d }
  }
  return best?.key ?? null
}
