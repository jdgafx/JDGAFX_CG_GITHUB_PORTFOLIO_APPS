import { describe, expect, it } from 'vitest'
import { singleSourceLatestIssues } from '../../netlify/shared/graph/nodes'

// One stale page must not be the sole authority for a latest/current value (endoflife.date/nodejs
// served a 5-day-stale snapshot twice, acceptance D3). Assertive one-source claims go back for a
// hedge or a second citation; honest hedges, corroborated sentences and uncited ones do not.

describe('singleSourceLatestIssues', () => {
  it('flags an assertive latest claim backed by a single source — the D3 sentence verbatim', () => {
    const issues = singleSourceLatestIssues(
      'Node.js 26 is labeled "Upcoming LTS" by endoflife.date, with 26.10.0 as its latest release [2].',
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].quote).toContain('26.10.0')
    expect(issues[0].fix).toContain('cannot confirm')
  })

  it('flags a single-source current value even with a currently phrasing', () => {
    const issues = singleSourceLatestIssues('npm is currently published at 12.2.0 [1].')
    expect(issues).toHaveLength(1)
  })

  it('leaves an honest hedge alone', () => {
    expect(singleSourceLatestIssues('The sources cannot confirm the latest npm version [1].')).toEqual([])
    expect(singleSourceLatestIssues('The page shows 12.2.0, but the sources do not say it is the latest [1].')).toEqual([])
    expect(singleSourceLatestIssues('Checking the registry would confirm the latest version [1].')).toEqual([])
  })

  it('leaves a two-source sentence alone — the text itself is corroborated', () => {
    expect(singleSourceLatestIssues('The latest release is 12.1.0 [2] while the package page shows 12.2.0 [1].')).toEqual([])
  })

  it('leaves ordinary single-source facts and uncited sentences to their own checks', () => {
    expect(singleSourceLatestIssues("Lisbon hosted Expo '98 in 1998 [1].")).toEqual([])
    expect(singleSourceLatestIssues('The latest version is stated nowhere.')).toEqual([])
  })
})