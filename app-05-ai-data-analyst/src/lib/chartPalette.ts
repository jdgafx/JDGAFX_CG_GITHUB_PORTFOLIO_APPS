import { useEffect, useState } from 'react'

export interface ChartPalette {
  /** Single-series marks: the design-system accent token. */
  accent: string
  /** Categorical slots for pie slices, in fixed order. */
  series: string[]
  /** The folded "Other" slice. */
  other: string
  text: string
  muted: string
  grid: string
  surface: string
}

const SERIES_VARS = ['--viz-1', '--viz-2', '--viz-3', '--viz-4', '--viz-5', '--viz-6', '--viz-7', '--viz-8']

/**
 * SVG presentation attributes do not reliably resolve var(), so chart colours are
 * read from the computed custom properties and passed to Recharts as plain values.
 */
function readVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

export function readChartPalette(): ChartPalette {
  return {
    accent: readVar('--ds-accent', '#3557d6'),
    series: SERIES_VARS.map((name) => readVar(name, '#2a78d6')),
    other: readVar('--viz-other', '#898781'),
    text: readVar('--ds-text', '#141a24'),
    muted: readVar('--ds-text-muted', '#5a6474'),
    grid: readVar('--ds-border', '#d9dee7'),
    surface: readVar('--ds-surface', '#ffffff'),
  }
}

/** Re-reads the palette when the OS switches between light and dark. */
export function useChartPalette(): ChartPalette {
  const [palette, setPalette] = useState<ChartPalette>(readChartPalette)

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setPalette(readChartPalette())
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return palette
}
