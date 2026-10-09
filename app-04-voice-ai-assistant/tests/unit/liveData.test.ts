import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { liveData, liveText } from '../../src/lib/liveData'

const weather = { call: 'weather("Lisbon")', status: 'ok' as const, source: 'https://api.open-meteo.com/v1/forecast?x=1' }
const wiki = { call: 'wikipedia_summary("Ada Lovelace")', status: 'ok' as const, source: 'https://en.wikipedia.org/wiki/Ada_Lovelace' }

describe('liveData', () => {
  it('is idle, naming both sources, before any tool has fetched anything', () => {
    expect(liveData([])).toEqual({ state: 'idle', sources: ['Open-Meteo', 'Wikipedia'] })
    expect(liveText(liveData([]))).toBe('Live data: Open-Meteo, Wikipedia')
  })

  it('stays idle for a question the model answered without a tool, and for model steps', () => {
    expect(liveData([{ status: 'ok' }, { status: 'ok', call: undefined }]).state).toBe('idle')
  })

  it('lights up only for a successful tool call with a source, and names that source and the fetch time', () => {
    const at = new Date(2026, 9, 9, 14, 32).getTime()
    const out = liveData([{ status: 'ok' }, weather], { 1: at })
    expect(out).toMatchObject({ state: 'live', sources: ['Open-Meteo'], fetchedAt: '14:32' })
    expect(liveText(out)).toBe('Live data: Open-Meteo, fetched 14:32')
  })

  it('does not count a tool call that returned no source (nothing was fetched)', () => {
    expect(liveData([{ ...weather, source: undefined }]).state).toBe('idle')
  })

  it('names every source that was used', () => {
    expect(liveData([weather, wiki]).sources).toEqual(['Open-Meteo', 'Wikipedia'])
  })

  it('goes to failed, naming the source, when a lookup failed', () => {
    const out = liveData([weather, { call: 'wikipedia_summary("x")', status: 'failed' }])
    expect(out).toMatchObject({ state: 'failed', sources: ['Wikipedia'] })
    expect(liveText(out)).toBe('Live data unavailable: Wikipedia')
  })
})

// No visitor path may carry canned data: the app's own code never imports test fixtures or ships sample results.
describe('no canned data in src/ or netlify/', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap(name => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? files(path) : [path]
    })
  const source = [...files('src'), ...files('netlify')].filter(f => /\.(ts|tsx|json)$/.test(f))

  it('has no data files and no imports from tests', () => {
    expect(source.filter(f => f.endsWith('.json'))).toEqual([])
    for (const file of source) expect(readFileSync(file, 'utf8'), file).not.toMatch(/from ['"][./]*\/?tests?\//)
  })

  it('has no sample, demo or mock result constants', () => {
    for (const file of source) expect(readFileSync(file, 'utf8'), file).not.toMatch(/\b(SAMPLE|DEMO|MOCK|CANNED|FAKE)_[A-Z]+|sampleData|mockData|cannedAnswer|fakeWeather/)
  })
})
