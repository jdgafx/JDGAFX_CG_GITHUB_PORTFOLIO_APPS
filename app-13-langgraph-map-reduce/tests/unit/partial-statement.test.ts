import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { citedPointIds, computeCoverage, pointIdsOf } from '../../netlify/shared/coverage'
import { mergeFindings } from '../../netlify/shared/merge'
import { parseSummary } from '../../netlify/shared/parse'
import { attributeMessages, checkMessages } from '../../netlify/shared/prompts'
import { unusedPoints } from '../../src/lib/coverage-text'
import type { Finding, Summary } from '../../src/types/frames'

interface Fixture {
  chunks: Array<{ chunk: number; points: string[] }>
  summary: { overview: string; sections: Array<{ heading: string; points: Array<{ text: string; chunks: number[] }> }> }
  stated: Record<string, string[]>
  reviewFlags: string[]
}

/** SP2 30e7b9c r2-a (Photosynthesis): sentence 4 says "releases oxygen" and nothing of water splitting, and the check credited it with point 1.2. */
const R2A = JSON.parse(readFileSync('tests/fixtures/r2-a-photosynthesis.json', 'utf8')) as Fixture
const CHUNK_IDS = R2A.chunks.map((c) => c.chunk)
const finding = (chunkId: number, points: string[]): Finding => ({ chunkId, points, entities: [], model: null, usage: null })
const merged = () => mergeFindings(R2A.chunks.map((c) => finding(c.chunk, c.points)))
const sentences = (): string[] => R2A.summary.sections.flatMap((s) => s.points.map((p) => p.text))
const WATER_SPLITTING = '[1.2] The term photosynthesis usually refers to oxygenic photosynthesis, which releases oxygen as a byproduct of water splitting.'

describe('a sentence that gives only part of a key point does not state it (SP2 30e7b9c r2-a)', () => {
  it('tells the attribution call that a point is stated only when the sentences say all of it, with the r2-a sentence and point in front of it', () => {
    const [system, user] = attributeMessages(sentences(), 1, merged().byChunk[0]!.points).map((m) => m.content)

    // The sentence the lenient check credited and the point it only half says.
    expect(user).toContain('4. Oxygenic photosynthesis, used by plants, algae, and cyanobacteria, releases oxygen and is the most common type.')
    expect(user).toContain(WATER_SPLITTING)
    expect(system).toMatch(/only when it says the key point's main claim in full/)
    expect(system).toMatch(/including the cause, mechanism or result the point gives/)
    expect(system).toMatch(/only part of the main claim.*does not state it/)
  })

  // This passes before the prompt change too: it fixes what happens downstream once the check no longer credits 1.2.
  it('lists 1.2 as not used, sends it to the review, and shows it flagged when the review finds it central', () => {
    const m = merged()
    const ids = pointIdsOf(m)
    const parsed = parseSummary(JSON.stringify(R2A.summary), CHUNK_IDS) as Summary
    let n = 0
    const strict = (stated: Record<string, string[]>): Summary => ({
      ...parsed,
      sections: parsed.sections.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p, points: stated[String((n += 1))] ?? [] })) })),
    })
    const lenient = strict(R2A.stated)
    n = 0
    const strictStated = { ...R2A.stated, '4': ['5.1'] }
    const checked = strict(strictStated)

    expect(citedPointIds(lenient, ids).has('1.2')).toBe(true)
    const citedPoints = citedPointIds(checked, ids)
    const coverage = computeCoverage({ chunkIds: CHUNK_IDS, withPoints: new Set(CHUNK_IDS), cited: new Set(CHUNK_IDS), pointIds: ids, citedPoints, unchecked: [] })
    expect(coverage.uncitedPoints).toContain('1.2')
    expect(coverage.citedPoints).toHaveLength(25)

    const unused = m.byChunk.flatMap((c) => c.points).filter((p) => !citedPoints.has(p.id))
    const [, user] = checkMessages(checked, unused).map((x) => x.content)
    expect(user).toContain(WATER_SPLITTING)

    const shown = unusedPoints({ coverage, keyPoints: m.byChunk.map((c) => ({ chunk: c.chunkId, points: c.points })), reviewFlags: ['1.2'] })
    expect(shown.find((p) => p.id === '1.2')).toEqual({ id: '1.2', text: R2A.chunks[0]!.points[1], flagged: true })
  })
})
