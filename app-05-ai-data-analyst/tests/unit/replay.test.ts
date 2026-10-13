import { describe, expect, it } from 'vitest'
import { glanceFor } from '../../src/lib/liveGlance'
import { parseEarthquakeCsv } from '../../src/lib/liveData/parse'
import { TRY_QUESTION } from '../../src/lib/howto'
import { recordsThisRun, replayDisabled, requestMatches } from '../../src/lib/useReplay'
import type { Recording } from '../../src/replay'
import { USGS_WEEK_EXCERPT } from '../fixtures/usgsWeek'

const headers = parseEarthquakeCsv(USGS_WEEK_EXCERPT).headers
const body = (extra: Record<string, unknown> = {}) => JSON.stringify({ question: TRY_QUESTION, headers, sampleRows: [{ a: '1' }], rowCount: 59, ...extra })

function recording(request: string | null): Recording {
  return {
    version: 1,
    app: 'app-05-ai-data-analyst',
    url: 'https://example.test/',
    recorded_at: new Date().toISOString(),
    reported: { model: 'm', model_role: 'served by', cost_usd: 0.001, cost_scope: 'whole run' },
    exchanges: [{ method: 'POST', path: '/api/ai', request_body: request, status: 200, headers: {}, t_start: 0, t_headers: 5, t_end: 6, chunks: [{ t: 5, text: '{}' }] }],
  }
}

describe('requestMatches', () => {
  it('ignores the sample rows and the row count, which move with the live feed', () => {
    expect(requestMatches(body(), body({ sampleRows: [{ b: '2' }], rowCount: 2024 }))).toBe(true)
  })
  it('does not match another question, other columns or a follow-up', () => {
    expect(requestMatches(body(), body({ question: 'Count by type' }))).toBe(false)
    expect(requestMatches(body(), body({ headers: ['time'] }))).toBe(false)
    expect(requestMatches(body(), body({ previous: { question: 'q', plan: {} } }))).toBe(false)
  })
  it('does not match a body that is not JSON', () => {
    expect(requestMatches(body(), 'nope')).toBe(false)
    expect(requestMatches(null, body())).toBe(false)
  })
})

describe('recordsThisRun', () => {
  it('is true only for the example question about the columns on screen', () => {
    expect(recordsThisRun(recording(body()), headers)).toBe(true)
    expect(recordsThisRun(recording(body({ question: 'Count by type' })), headers)).toBe(false)
    expect(recordsThisRun(recording(body()), ['time', 'mag'])).toBe(false)
    expect(recordsThisRun({ ...recording(body()), exchanges: [] }, headers)).toBe(false)
  })
})

describe('replayDisabled', () => {
  it('is on for ?replay=off only', () => {
    expect(replayDisabled('?replay=off')).toBe(true)
    expect(replayDisabled('')).toBe(false)
    expect(replayDisabled('?replay=on')).toBe(false)
  })
})

describe('glanceFor', () => {
  it('counts the rows of the live feed per UTC day, from the rows themselves', () => {
    const data = parseEarthquakeCsv(USGS_WEEK_EXCERPT)
    const glance = glanceFor(data)
    expect(glance?.total).toBe(data.rows.length)
    expect(glance?.days.reduce((sum, day) => sum + day.count, 0)).toBe(data.rows.length)
    expect(glance?.days.map((day) => day.label)).toEqual(['2026-10-09', '2026-10-10'].filter((day) => data.rows.some((row) => row.time?.startsWith(day))))
    expect(glance?.latest).toBe('2026-10-10T01:10:35.819Z')
    expect(glance?.strongest?.mag).toBe(Math.max(...data.rows.map((row) => Number(row.mag)).filter((mag) => !Number.isNaN(mag))))
  })
  it('fills a day with no quake with zero, and is null for a table without time and mag', () => {
    const data = { headers: ['time', 'mag', 'place'], rows: [{ time: '2026-10-01T01:00:00Z', mag: '1', place: 'a' }, { time: '2026-10-03T01:00:00Z', mag: '2', place: 'b' }] }
    expect(glanceFor(data)?.days).toEqual([{ label: '2026-10-01', count: 1 }, { label: '2026-10-02', count: 0 }, { label: '2026-10-03', count: 1 }])
    expect(glanceFor({ headers: ['date', 'temp'], rows: [{ date: '2026-10-01', temp: '1' }] })).toBeNull()
  })
})
