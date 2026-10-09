import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { liveDataOf } from '../../src/lib/live-data'
import type { DuplicateReport } from '../../src/types'

const report = (status: DuplicateReport['status'], candidates = 0): DuplicateReport => ({
  status,
  message: null,
  terms: [],
  candidates: Array.from({ length: candidates }, (_, i) => ({ number: i + 1 }) as DuplicateReport['candidates'][number]),
  confirmed: null,
})
const base = { loading: false, issuesError: null, fetchedAt: null, duplicates: null }
const noon = new Date(2026, 9, 9, 14, 32).getTime()

describe('liveDataOf', () => {
  it('is idle until a GitHub fetch has succeeded, and while one is loading', () => {
    expect(liveDataOf(base)).toEqual({ state: 'idle', text: 'Live data: GitHub' })
    expect(liveDataOf({ ...base, loading: true, fetchedAt: noon }).state).toBe('idle')
  })

  it('lights up with the fetch time once the issues were fetched and parsed', () => {
    expect(liveDataOf({ ...base, fetchedAt: noon })).toEqual({ state: 'live', text: 'Live data: GitHub · fetched 14:32' })
  })

  it('fails when the issue fetch failed, even if an earlier fetch had worked', () => {
    expect(liveDataOf({ ...base, fetchedAt: noon, issuesError: 'GitHub did not answer in time.' })).toEqual({ state: 'failed', text: 'Live data unavailable: GitHub' })
  })

  it('fails when the duplicate search could not reach GitHub, but not when only the judge failed', () => {
    expect(liveDataOf({ ...base, fetchedAt: noon, duplicates: report('unavailable') }).state).toBe('failed')
    expect(liveDataOf({ ...base, fetchedAt: noon, duplicates: report('unavailable', 5) }).state).toBe('live')
    expect(liveDataOf({ ...base, fetchedAt: noon, duplicates: report('checked', 3) }).state).toBe('live')
    expect(liveDataOf({ ...base, fetchedAt: noon, duplicates: report('skipped') }).state).toBe('live')
  })
})

/** Mocks and sample data belong in tests and scripts. Nothing a visitor can reach may carry a canned dataset or result. */
describe('no canned data in src or netlify', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
    })

  it.each(['src', 'netlify'])('%s has no sample, demo, mock or fixture constants, and no recorded GitHub reply', (dir) => {
    for (const path of files(dir)) {
      const text = readFileSync(path, 'utf8')
      expect(text, path).not.toMatch(/\b(?:const|let|var|export\s+const)\s+[A-Za-z_]*(?:SAMPLE|DEMO|MOCK|FIXTURE|CANNED|FAKE)[A-Za-z_]*\s*[=:]/i)
      expect(text, path).not.toMatch(/\bfrom\s+['"][^'"]*(?:fixtures?|mocks?)\//)
    }
  })
})
