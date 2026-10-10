import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fetchedTime, liveInputs, liveState, liveText, type LiveInputs } from '../../src/lib/liveData'

const base: LiveInputs = { downloadsLoading: false, downloadsParsed: 0, downloadsFailed: 0, releasesLoading: false, releasesParsed: 0, releasesFailed: 0 }

describe('the live data indicator state', () => {
  it('is idle until something has loaded, and while the first fetches are going', () => {
    expect(liveState(base)).toBe('idle')
    expect(liveState({ ...base, downloadsLoading: true })).toBe('idle')
    expect(liveState({ ...base, downloadsParsed: 3, releasesLoading: true })).toBe('idle')
  })

  it('is live only when the downloads and the registry reads both succeeded and parsed', () => {
    expect(liveState({ ...base, downloadsParsed: 3, releasesParsed: 3 })).toBe('live')
    expect(liveState({ ...base, downloadsParsed: 3 })).toBe('idle') // registry has not parsed anything
    expect(liveState({ ...base, releasesParsed: 3 })).toBe('idle') // downloads have not parsed anything
  })

  it('is failed as soon as either source failed for any package', () => {
    expect(liveState({ ...base, downloadsParsed: 2, downloadsFailed: 1, releasesParsed: 3 })).toBe('failed')
    expect(liveState({ ...base, downloadsParsed: 3, releasesParsed: 2, releasesFailed: 1 })).toBe('failed')
    expect(liveState({ ...base, downloadsFailed: 1, downloadsLoading: true })).toBe('failed')
  })

  it('goes idle to live to failed as a fetch history plays out', () => {
    const history: LiveInputs[] = [
      { ...base, downloadsLoading: true, releasesLoading: true },
      { ...base, downloadsParsed: 3, releasesLoading: true },
      { ...base, downloadsParsed: 3, releasesParsed: 3 },
      { ...base, downloadsParsed: 3, releasesParsed: 2, releasesFailed: 1 },
    ]
    expect(history.map(liveState)).toEqual(['idle', 'idle', 'live', 'failed'])
  })
})

describe('the words', () => {
  const at = new Date(2026, 9, 9, 14, 32).getTime()
  it('names the source, adds the fetch time when live, and says unavailable when failed', () => {
    expect(fetchedTime(at)).toBe('14:32')
    expect(liveText('idle', null)).toBe('Live data: npm registry')
    expect(liveText('live', at)).toBe('Live data: npm registry · fetched 14:32')
    expect(liveText('live', null)).toBe('Live data: npm registry')
    expect(liveText('failed', at)).toBe('Live data unavailable: npm registry')
  })
})

describe('nothing canned is reachable', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
    })
  const sources = [...files('src'), ...files('netlify')]

  it('has no sample, demo or mock data constants, and nothing imports a fixture', () => {
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/\b(?:MOCK|SAMPLE|DEMO|FAKE|FIXTURE)_[A-Z]+|\b(?:mockData|sampleData|demoData|fakeData)\b/)
      expect(text, file).not.toMatch(/from ['"][^'"]*(?:fixtures|tests)\//)
    }
  })

  it('reads downloads and releases only from the live hosts', () => {
    const hosts = new Set<string>()
    for (const file of sources) for (const m of readFileSync(file, 'utf8').matchAll(/https?:\/\/([a-z0-9.-]+)/g)) hosts.add(m[1])
    for (const host of ['api.npmjs.org', 'registry.npmjs.org']) expect(hosts.has(host)).toBe(true)
  })
})

describe('what each source said (D23)', () => {
  it('stays live when one name is unknown to npm and the others loaded', () => {
    const inputs = liveInputs(
      { loading: false, results: ['ok', 'ok', 'not-found'] },
      { loading: false, results: ['ok', 'ok', 'not-found'] },
    )
    expect(liveState(inputs)).toBe('live')
  })

  it('is failed when a known package failed on either side, and idle while loading', () => {
    expect(liveState(liveInputs({ loading: false, results: ['ok', 'failed'] }, { loading: false, results: ['ok', 'ok'] }))).toBe('failed')
    expect(liveState(liveInputs({ loading: false, results: ['ok', 'ok'] }, { loading: false, results: ['ok', 'failed'] }))).toBe('failed')
    expect(liveState(liveInputs({ loading: true, results: [] }, { loading: true, results: [] }))).toBe('idle')
  })
})
