/** Pure geometry for the SVG charts: ticks, scales, arcs and label thinning. No DOM, so it is unit tested. */

/** Round tick values covering [min, max], starting at zero when the data is all non-negative. */
export function niceTicks(min: number, max: number, target = 4): number[] {
  const low = Math.min(0, min)
  const high = Math.max(0, max)
  if (low === high) return [0, 1]
  const rough = (high - low) / target
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const fraction = rough / magnitude
  const step = (fraction <= 1.5 ? 1 : fraction <= 3 ? 2 : fraction <= 7 ? 5 : 10) * magnitude
  const ticks: number[] = []
  const first = Math.floor(low / step) * step
  for (let value = first; value <= high + step * 0.999; value += step) {
    ticks.push(Number(value.toFixed(10)))
    if (value >= high) break
  }
  return ticks
}

/** Maps a value in [d0, d1] onto [r0, r1]. A flat domain maps to the middle of the range. */
export function scaleLinear(d0: number, d1: number, r0: number, r1: number): (value: number) => number {
  if (d0 === d1) return () => (r0 + r1) / 2
  return (value) => r0 + ((value - d0) / (d1 - d0)) * (r1 - r0)
}

/** An axis number as short text: 1.2k, 3.4M, 0.25. */
export function formatTick(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${trim(value / 1_000_000)}M`
  if (Math.abs(value) >= 1_000) return `${trim(value / 1_000)}k`
  return trim(value)
}

function trim(value: number): string {
  return String(Number(value.toFixed(2)))
}

/** A category label cut to `max` characters with an ellipsis. */
export function truncateLabel(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

/** Indexes of the labels to print when there are too many to read: evenly spaced, always including the last. */
export function thinIndexes(count: number, max: number): Set<number> {
  const keep = new Set<number>()
  if (count <= max) {
    for (let i = 0; i < count; i += 1) keep.add(i)
    return keep
  }
  const stride = Math.ceil(count / max)
  for (let i = 0; i < count; i += stride) keep.add(i)
  keep.add(count - 1)
  // The last label may sit too close to the one before it, so that one gives way.
  const last = count - 1
  const near = last - (last % stride)
  if (near !== last) keep.delete(near)
  return keep
}

/** One ring segment as an SVG path, angles in radians clockwise from twelve o'clock. */
export function arcPath(cx: number, cy: number, inner: number, outer: number, start: number, end: number): string {
  const point = (radius: number, angle: number) => [cx + radius * Math.sin(angle), cy - radius * Math.cos(angle)] as const
  // A full circle cannot be drawn by one arc, so it is stopped a hair short of closing.
  const stop = Math.min(end, start + Math.PI * 2 - 0.0001)
  const large = stop - start > Math.PI ? 1 : 0
  const [x0, y0] = point(outer, start)
  const [x1, y1] = point(outer, stop)
  const [x2, y2] = point(inner, stop)
  const [x3, y3] = point(inner, start)
  const f = (n: number) => n.toFixed(2)
  return `M${f(x0)} ${f(y0)}A${outer} ${outer} 0 ${large} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${inner} ${inner} 0 ${large} 0 ${f(x3)} ${f(y3)}Z`
}

/**
 * Keeps the largest groups so the axis stays readable. Sums the tail into "Other" only when that is
 * arithmetically meaningful (sum and count); for avg, min and max the tail is dropped and the note says so.
 */
export interface LimitedGroups {
  labels: string[]
  values: number[]
  note: string | null
}

export const OTHER_LABEL = 'Other'

export function limitGroups(labels: string[], values: number[], max: number, combine: boolean): LimitedGroups {
  if (labels.length <= max) return { labels, values, note: null }

  const ranked = labels
    .map((label, i) => ({ label, value: values[i] ?? 0 }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))

  const keep = combine ? ranked.slice(0, max - 1) : ranked.slice(0, max)
  const tail = ranked.slice(keep.length)
  const outLabels = keep.map((g) => g.label)
  const outValues = keep.map((g) => g.value)

  if (combine) {
    outLabels.push(OTHER_LABEL)
    outValues.push(tail.reduce((a, g) => a + g.value, 0))
  }

  const rest = combine
    ? `The remaining ${tail.length} are combined as "${OTHER_LABEL}".`
    : `${tail.length} smaller groups are not plotted.`
  return {
    labels: outLabels,
    values: outValues,
    note: `Showing the ${keep.length} largest of ${labels.length} groups. ${rest}`,
  }
}
