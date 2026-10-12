import { afterEach, describe, expect, it } from 'vitest'
import type { PackageFacts, UnusualRow } from '../../shared/types'
import Charts from '../../src/components/Charts'
import Metrics, { changeText } from '../../src/components/Metrics'
import Notices from '../../src/components/Notices'
import Readout from '../../src/components/Readout'
import UnusualTable from '../../src/components/UnusualTable'
import type { RunState, Snapshot } from '../../src/lib/useRun'
import { cleanup, mount } from '../ui/helpers'
import { stubFacts, stubWindow } from '../ui/stubCore'

afterEach(cleanup)

const WINDOW = stubWindow('2026-10-12', 30) // 2026-09-12 .. 2026-10-11

describe('Metrics change text', () => {
  const withGrowth = (S1: bigint, S0: bigint): PackageFacts => {
    const f = stubFacts('vite', 0)
    return { ...f, aggregates: { ...f.aggregates, growth: { S1, n1: 30, S0, n0: 30, computable: true } } }
  }
  it('a small fall that rounds to zero reads +0.0%, never -0.0%', () => {
    expect(changeText(withGrowth(999_999n, 1_000_000n))).toBe('+0.0%')
    expect(changeText(withGrowth(990_000n, 1_000_000n))).toBe('-1.0%')
    expect(changeText(withGrowth(1_100_000n, 1_000_000n))).toBe('+10.0%')
  })
})

describe('Metrics', () => {
  const text = (el: Element) => el.textContent?.replace(/\s+/g, ' ')

  it('shows window total, average per day, change, unusual days, and the combined total and share for 2 or more', () => {
    const facts = [stubFacts('vite', 3), stubFacts('webpack', 1)]
    const { container } = mount(<Metrics facts={facts} window={WINDOW} />)
    const cards = container.querySelectorAll('.metrics__package')
    expect(cards).toHaveLength(2)
    const first = text(cards[0]!)!
    expect(first).toContain('vite')
    expect(first).toContain('Window total5,000,000')
    expect(first).toContain('Average per day166,667')
    expect(first).toContain('Change+14.3%')
    expect(first).toContain('Unusual days3')
    expect(first).toContain('Share of combined total50.0%')
    expect(text(container.querySelector('.metrics__combined')!)).toContain('Combined total10,000,000')
  })

  it('says n/a when growth is not computable, and leaves out combined and share for one package', () => {
    const f = stubFacts('zod', 0)
    f.aggregates.growth = { S1: 5n, n1: 3, S0: 0n, n0: 0, computable: false }
    const { container } = mount(<Metrics facts={[f]} window={WINDOW} />)
    expect(text(container)).toContain('Changen/a')
    expect(container.querySelector('.metrics__combined')).toBeNull()
    expect(text(container)).not.toContain('Share of combined total')
  })

  it('shows a negative change with its sign and one decimal', () => {
    const f = stubFacts('zod', 0)
    f.aggregates.growth = { S1: 600n, n1: 30, S0: 700n, n0: 30, computable: true }
    const { container } = mount(<Metrics facts={[f]} window={WINDOW} />)
    expect(text(container)).toContain('Change-14.3%')
  })
})

describe('Charts', () => {
  const spike: UnusualRow = { day: '2026-09-20', value: 5000, median: 1000, kind: 'spike', release: 'none' }
  const drop: UnusualRow = { day: '2026-09-25', value: 100, median: 1000, kind: 'drop', release: 'none' }
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.parse('2026-09-12T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10))
  const rows = Object.fromEntries(days.map(d => [d, d === '2026-09-20' ? 5000 : d === '2026-09-28' ? 0 : 1000]))
  const a: PackageFacts = { ...stubFacts('a', 0), unusual: [spike, drop], possibleGaps: ['2026-09-28'] }
  const b: PackageFacts = stubFacts('b', 0)
  const window = { ...WINDOW, noData: ['2026-09-14', '2026-09-15', '2026-08-01'] }

  const render = () =>
    mount(
      <Charts
        names={['a', 'b']}
        window={window}
        rowsByName={{ a: rows, b: rows }}
        facts={[a, b]}
        releases={{ a: [{ day: '2026-09-18', version: '1.0.0' }, { day: '2026-09-19', version: '1.0.1' }, { day: '2026-10-01', version: '1.1.0' }, { day: '2026-01-01', version: '0.9.0' }], b: [] }}
        releaseState={{ a: 'ok', b: 'failed' }}
      />,
    ).container

  it('draws one SVG per package with a text description', () => {
    const svgs = render().querySelectorAll('svg')
    expect(svgs).toHaveLength(2)
    expect(svgs[0]!.getAttribute('role')).toBe('img')
    expect(svgs[0]!.getAttribute('aria-label')).toContain('a')
  })

  it('marks unusual dots, release ticks in the window, no-data days and possible gaps', () => {
    const svg = render().querySelectorAll('svg')[0]!
    expect(svg.querySelectorAll('.chart-dot--spike')).toHaveLength(1)
    expect(svg.querySelectorAll('.chart-dot--drop')).toHaveLength(1)
    expect(svg.querySelectorAll('.chart-release')).toHaveLength(3)
    expect(svg.querySelectorAll('.chart-nodata')).toHaveLength(2)
    const gap = svg.querySelector('.chart-gap')!
    expect(gap.getAttribute('fill')).toBe('none')
  })

  it('breaks the line at no-data days and gaps instead of dropping to zero', () => {
    const svg = render().querySelectorAll('svg')[0]!
    const lines = svg.querySelectorAll('polyline.ds-c-line')
    expect(lines.length).toBe(3)
    const pts = Array.from(lines).flatMap(l => l.getAttribute('points')!.split(' '))
    expect(pts).toHaveLength(30 - 2 - 1)
  })

  it('says so when a package has no release history', () => {
    const figs = render().querySelectorAll('figure.ds-chart')
    expect(figs[1]!.textContent).toContain('Release history unavailable')
    expect(figs[0]!.textContent).not.toContain('Release history unavailable')
  })

  it('uses the series colours in selection order', () => {
    const lines = render().querySelectorAll('polyline.ds-c-line')
    expect(lines[0]!.getAttribute('class')).toContain('ds-c-s1')
    expect(Array.from(lines).some(l => l.getAttribute('class')?.includes('ds-c-s2'))).toBe(true)
  })
})

describe('UnusualTable', () => {
  const facts: PackageFacts[] = [
    {
      ...stubFacts('vite', 0),
      unusual: [
        { day: '2026-09-20', value: 5000, median: 1000, kind: 'spike', release: 2, version: '7.1.6' },
        { day: '2026-09-25', value: 100, median: 1000, kind: 'drop', release: 'none' },
      ],
      possibleGaps: ['2026-09-28'],
      notAssessed: ['2026-09-12', '2026-09-13'],
    },
    { ...stubFacts('zod', 0), unusual: [{ day: '2026-09-21', value: 4000, median: 1000, kind: 'spike', release: 'unavailable' }] },
  ]

  it('has the agreed columns and a row per unusual day with its release version, none or unavailable', () => {
    const { container } = mount(<UnusualTable facts={facts} />)
    const heads = Array.from(container.querySelectorAll('th')).map(th => th.textContent)
    expect(heads).toEqual(['Day', 'Package', 'Kind', 'Value', 'Base', 'Release'])
    const rows = Array.from(container.querySelectorAll('tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent))
    expect(rows).toContainEqual(['2026-09-20', 'vite', 'spike', '5,000', '1,000', '7.1.6'])
    expect(rows).toContainEqual(['2026-09-25', 'vite', 'drop', '100', '1,000', 'none'])
    expect(rows).toContainEqual(['2026-09-21', 'zod', 'spike', '4,000', '1,000', 'unavailable'])
  })

  it('shows a half-day median baseline instead of crashing the page', () => {
    const f: PackageFacts = { ...stubFacts('vite', 0), unusual: [{ day: '2026-09-20', value: 5000, median: 3623326.5, kind: 'spike', release: 'none' }] }
    const { container } = mount(<UnusualTable facts={[f]} />)
    expect(container.querySelector('tbody tr')?.textContent).toContain('3,623,326.5')
  })

  it('lists possible npm gaps and a not-assessed row per package', () => {
    const { container } = mount(<UnusualTable facts={facts} />)
    const text = container.textContent!
    expect(text).toContain('possible npm gap')
    expect(text).toContain('not assessed')
    const notAssessed = Array.from(container.querySelectorAll('tbody tr')).find(tr => tr.textContent?.includes('not assessed') && tr.textContent.includes('vite'))!
    expect(notAssessed.querySelector('td')?.getAttribute('title')).toContain('2026-09-12')
  })

  it('says when there is nothing unusual', () => {
    const { container } = mount(<UnusualTable facts={[{ ...stubFacts('vite', 0) }]} />)
    expect(container.textContent).toContain('No unusual days in this window.')
  })
})

describe('Readout', () => {
  const base: RunState = {
    phase: 'done',
    snapshot: null,
    outcomes: {},
    servedModel: 'anthropic/claude-haiku-5.5',
    marker: 'match',
    modelOutcome: 'ok',
    elapsedMs: 15_500,
    reasoningTokens: 2159,
    cost: 0.00160875,
    costUnreported: 0,
  }
  const text = (run: RunState) => mount(<Readout run={run} />).container.textContent!

  it('shows the model chip, elapsed seconds, reasoning tokens and cost', () => {
    const t = text(base)
    expect(t).toContain('claude-haiku-5.5')
    expect(t).toContain('15.5 s')
    expect(t).toContain('2,159')
    expect(t).toContain('$0.0016')
  })

  it('says cost unknown, and shows the unavailable chip when every call failed', () => {
    expect(text({ ...base, cost: null })).toContain('cost unknown')
    expect(text({ ...base, modelOutcome: 'all-failed', servedModel: null, cost: null, reasoningTokens: null })).toContain('model · unavailable')
  })

  it('says at least when some calls reported no cost, and counts them', () => {
    expect(text({ ...base, costUnreported: 1 })).toContain('at least $0.0016 (1 call not reported)')
    expect(text({ ...base, costUnreported: 3 })).toContain('at least $0.0016 (3 calls not reported)')
    expect(text(base)).not.toContain('at least')
  })

  it('says cost unknown, not $0.0000, when nothing was reported', () => {
    const t = text({ ...base, cost: null, costUnreported: 2 })
    expect(t).toContain('cost unknown')
    expect(t).not.toContain('$')
  })

  it('shows dashes while the run is live', () => {
    const { container } = mount(<Readout run={{ ...base, phase: 'running', elapsedMs: null, reasoningTokens: null, cost: null, costUnreported: 0, modelOutcome: 'ok' }} />)
    expect(container.querySelector('.ds-strip--pending')).not.toBeNull()
  })
})

describe('Notices', () => {
  const snap = (over: Partial<Snapshot>): Snapshot => ({
    runDate: '2026-10-12',
    names: ['vite', 'zod'],
    days: 30,
    rowsByName: { vite: {} },
    failedNames: [],
    releases: {},
    releaseState: { vite: 'ok' },
    window: { ...WINDOW, noData: ['2026-09-14'] },
    facts: [{ ...stubFacts('vite', 0), possibleGaps: ['2026-09-28'] }],
    error: null,
    ...over,
  })
  const text = (s: Snapshot) => mount(<Notices view={s} />).container.textContent!

  it('names a package whose downloads failed, the release history, no-data days and possible gaps', () => {
    const t = text(snap({ failedNames: ['zod'], releaseState: { vite: 'failed' } }))
    expect(t).toContain('npm did not return downloads for zod')
    expect(t).toContain('release history')
    expect(t).toContain('2026-09-14')
    expect(t).toContain('2026-09-28')
  })

  it('shows the window error as an error notice', () => {
    const { container } = mount(<Notices view={snap({ error: 'npm has not published recent days yet', window: null, facts: [] })} />)
    expect(container.querySelector('.ds-notice--error')?.textContent).toContain('npm has not published recent days yet')
  })

  it('shows nothing when there is nothing to say', () => {
    const { container } = mount(<Notices view={snap({ window: { ...WINDOW, noData: [] }, facts: [stubFacts('vite', 0)] })} />)
    expect(container.querySelector('.ds-notice')).toBeNull()
  })
})
