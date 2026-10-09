import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clock, indicatorFor } from '../../src/lib/liveData/indicator'
import type { DatasetState } from '../../src/hooks/useLiveDataset'
import type { LoadedDataset } from '../../src/types'

const AT = new Date(2026, 9, 9, 14, 32)
const loaded = (kind: 'live' | 'upload', label = 'x'): LoadedDataset => ({
  data: { headers: [], rows: [] } as unknown as LoadedDataset['data'],
  source: { kind, provider: 'p', label, detail: '', url: null, fetchedAt: AT },
})

describe('the live-data chip', () => {
  it('is idle and names the provider while the rows load', () => {
    expect(indicatorFor({ status: 'loading' }, 'quakes-week')).toMatchObject({ state: 'idle', label: 'Live data: USGS', title: 'earthquake.usgs.gov' })
    expect(indicatorFor({ status: 'idle' }, 'weather')).toMatchObject({ state: 'idle', label: 'Live data: Open-Meteo' })
  })

  it('lights with the fetch time only when the live rows are ready', () => {
    const ready: DatasetState = { status: 'ready', loaded: loaded('live') }
    const out = indicatorFor(ready, 'quakes-month')
    expect(out).toEqual({ state: 'live', label: `Live data: USGS · fetched ${clock(AT)}`, title: 'earthquake.usgs.gov' })
    expect(indicatorFor(ready, 'weather').label).toContain('Open-Meteo')
  })

  it('reads failed, naming the provider, when the fetch failed', () => {
    expect(indicatorFor({ status: 'error', message: 'down' }, 'weather')).toMatchObject({ state: 'failed', label: 'Live data unavailable: Open-Meteo' })
  })

  it('calls the visitor\'s own CSV "Your file", never live data', () => {
    const out = indicatorFor({ status: 'ready', loaded: loaded('upload', 'sales.csv') }, null)
    expect(out.label).toBe('Your file · sales.csv')
    expect(out.label).not.toContain('Live data')
  })
})

describe('nothing canned is bundled', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? files(path) : [path]
    })
  const code = [...files('src'), ...files('netlify')]

  it('has no data files and no import from tests or fixtures in src or netlify', () => {
    expect(code.filter((path) => /\.(json|csv|ndjson)$/.test(path))).toEqual([])
    for (const path of code.filter((p) => /\.(ts|tsx)$/.test(p))) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/from ['"][^'"]*(tests|fixtures)\//)
    }
  })
})
