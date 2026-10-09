import { describe, expect, it } from 'vitest'
import { axisMonth, EARTHQUAKE_VOCABULARY, labelFor, shownLabel, WEATHER_VOCABULARY, withUnit } from '../../src/lib/vocabulary'

describe('shownLabel', () => {
  it('reads a YYYY-MM group as a month name for the weather data', () => {
    expect(shownLabel(WEATHER_VOCABULARY, '2026-07')).toBe('July 2026')
    expect(shownLabel(WEATHER_VOCABULARY, '2025-12')).toBe('December 2025')
  })

  it('leaves other labels, impossible months and other datasets alone', () => {
    expect(shownLabel(WEATHER_VOCABULARY, '2026-13')).toBe('2026-13')
    expect(shownLabel(WEATHER_VOCABULARY, 'Alaska')).toBe('Alaska')
    expect(shownLabel(EARTHQUAKE_VOCABULARY, '2026-07')).toBe('2026-07')
  })
})

describe('axisMonth', () => {
  it('shortens the month and adds the year at the first label and each January', () => {
    expect(axisMonth('2025-10', true)).toEqual({ top: 'Oct', year: '2025' })
    expect(axisMonth('2025-11', false)).toEqual({ top: 'Nov', year: null })
    expect(axisMonth('2026-01', false)).toEqual({ top: 'Jan', year: '2026' })
    expect(axisMonth('Alaska', false)).toBeNull()
  })
})

describe('labels and units', () => {
  it('names columns in plain words and puts the unit after a value', () => {
    expect(labelFor(WEATHER_VOCABULARY, 'precipitation_mm')).toBe('rain')
    expect(labelFor(WEATHER_VOCABULARY, 'unknown_col')).toBe('unknown_col')
    expect(withUnit(WEATHER_VOCABULARY, 'temp_max_c', '12.4')).toBe('12.4 °C')
  })
})
