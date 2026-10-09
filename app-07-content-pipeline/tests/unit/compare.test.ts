import { describe, expect, it } from 'vitest'
import { compareStage, readabilityTrend } from '../../src/lib/compare'
import { withSources, type SourcePack } from '../../netlify/shared/sourcepack'

const DRAFT = 'Rust began in 2006. It guarantees memory safety without a garbage collector.'
const EDIT = 'Rust began in 2006 as a side project. It provides memory safety without a garbage collector.'
const NOTE = { text: 'Added the origin', passage: 'as a side project', side: 'new' as const }
const PACK: SourcePack = { sources: [{ n: 1, kind: 'wikipedia', title: 'Rust (programming language)', url: 'https://en.wikipedia.org/wiki/Rust', summary: 'Rust began in 2006 as a side project.' }], notes: [] }

describe('compareStage', () => {
  it('is null until the step and the one before it have finished', () => {
    expect(compareStage('edit', { draft: DRAFT }, {})).toBeNull()
    expect(compareStage('polish', { draft: DRAFT, edit: EDIT }, {})).toBeNull()
  })

  it('counts the real differences between Draft and Edit and carries the step\'s notes', () => {
    const result = compareStage('edit', { draft: DRAFT, edit: EDIT }, { edit: [NOTE] })
    expect(result?.stats).toEqual({ added: 6, removed: 2, sentencesRewritten: 2 })
    expect(result?.notes).toEqual([NOTE])
    expect(result?.from).toBe('draft')
  })

  it('compares Edit with Polish without the Sources list the function appended to Polish', () => {
    const polish = withSources(EDIT, PACK, 'Blog Post')
    expect(polish).toContain('### Sources')
    const result = compareStage('polish', { draft: DRAFT, edit: EDIT, polish }, {})
    expect(result?.stats).toEqual({ added: 0, removed: 0, sentencesRewritten: 0 })
  })
})

describe('readabilityTrend', () => {
  it('measures each finished prose stage in order and ignores the Sources list', () => {
    const polish = withSources(EDIT, PACK, 'Blog Post')
    const trend = readabilityTrend({ research: 'notes', draft: DRAFT, polish })
    expect(trend.map(point => point.stage)).toEqual(['draft', 'polish'])
    expect(trend[0]?.figures).toMatchObject({ words: 12, sentences: 2 })
    expect(trend[1]?.figures).toMatchObject({ words: 16, sentences: 2 })
  })

  it('is empty before the Draft', () => {
    expect(readabilityTrend({})).toEqual([])
  })
})
