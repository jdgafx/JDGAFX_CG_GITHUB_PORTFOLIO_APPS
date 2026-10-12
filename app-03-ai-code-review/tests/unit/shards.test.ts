import { describe, expect, it } from 'vitest'
import { buildDiff } from '../../netlify/shared/diff'
import { MAX_SHARDS, SHARD_CHANGED, SHARD_LINES, mergeComments, planShards } from '../../netlify/shared/shards'

const flat = (n: number) => Array.from({ length: n }, (_, i) => `    statement_${i + 1}()`)
/** A Go-like file: functions of `body` lines, a blank line between them, every line inside a body indented. */
function goLike(total: number, body = 30): string[] {
  const lines: string[] = []
  let n = 0
  while (lines.length < total) {
    n += 1
    lines.push(`func f${n}() {`, ...Array.from({ length: body }, (_, i) => `\tstep_${n}_${i}()`), '}', '')
  }
  return lines.slice(0, total)
}

describe('planShards: how many shards', () => {
  it.each([[1, 1], [50, 1], [SHARD_LINES, 1], [SHARD_LINES + 1, 2], [314, 2], [490, 3], [608, 4], [1178, 6]])('a %i-line file is %i shard(s)', (lines, count) => {
    expect(planShards(flat(lines), null, 15)).toHaveLength(count)
  })

  it('never makes more than the most shards, and never an empty one', () => {
    const plan = planShards(flat(5000), null, 15)
    expect(plan).toHaveLength(MAX_SHARDS)
    for (const s of plan) expect(s.to).toBeGreaterThanOrEqual(s.from)
    expect(planShards(flat(3), null, 5)).toHaveLength(1)
  })

  it('keeps a small file whole: one shard that is the whole of it and asks for the whole budget', () => {
    expect(planShards(flat(120), null, 8)).toEqual([{ index: 0, from: 1, to: 120, budget: 8 }])
  })
})

describe('planShards: the ranges', () => {
  it.each([314, 608, 1178, 4999])('cover lines 1 to %i exactly once, in order', (lines) => {
    const plan = planShards(goLike(lines), null, 15)
    expect(plan[0].from).toBe(1)
    expect(plan[plan.length - 1].to).toBe(lines)
    plan.forEach((s, i) => {
      expect(s.index).toBe(i)
      if (i > 0) expect(s.from).toBe(plan[i - 1].to + 1)
    })
  })

  it('starts each later shard on a top-level line after a blank line, so no shard begins in the middle of a function', () => {
    const lines = goLike(608)
    for (const s of planShards(lines, null, 15).slice(1)) {
      expect(lines[s.from - 2]).toBe('')
      expect(lines[s.from - 1]).toMatch(/^func /)
    }
  })

  it('falls back to a top-level line when the file has no blank lines, and to an even split when it has neither', () => {
    const noBlanks = goLike(608).filter((l) => l !== '')
    for (const s of planShards(noBlanks, null, 15).slice(1)) expect(noBlanks[s.from - 1]).toMatch(/^func |^\}/)
    const plan = planShards(flat(608), null, 15)
    expect(plan.map((s) => s.to - s.from + 1).every((n) => n > 100)).toBe(true)
  })

  it('keeps the shards close to even', () => {
    const sizes = planShards(goLike(608), null, 15).map((s) => s.to - s.from + 1)
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(60)
  })
})

describe('planShards: the comment budget', () => {
  it.each([[608, 15], [314, 15], [490, 12], [1178, 15]])('gives the shards of a %i-line file their share of %i comments, at least one each, none lost', (lines, total) => {
    const plan = planShards(goLike(lines), null, total)
    expect(plan.reduce((sum, s) => sum + s.budget, 0)).toBe(Math.max(total, plan.length))
    for (const s of plan) expect(s.budget).toBeGreaterThanOrEqual(1)
  })
})

describe('planShards: a pull request', () => {
  const patch = (changed: number, name: string) => ({ path: name, status: 'modified', patch: `@@ -1,${changed} +1,${changed} @@\n${Array.from({ length: changed }, (_, i) => `-old ${name} ${i}\n+new ${name} ${i}`).join('\n')}` })

  it('is one shard when the change is small, however long the numbered diff is', () => {
    const built = buildDiff([patch(20, 'a.go')])
    expect(planShards(built.units.map((u) => u.shown), built.units, 10)).toHaveLength(1)
  })

  it('splits by changed lines, at file headers where there are some', () => {
    const built = buildDiff([patch(50, 'a.go'), patch(50, 'b.go'), patch(50, 'c.go')])
    expect(built.changed).toBe(300)
    const plan = planShards(built.units.map((u) => u.shown), built.units, 15)
    expect(plan.length).toBe(Math.ceil(300 / SHARD_CHANGED))
    for (const s of plan.slice(1)) expect(built.units[s.from - 1].kind).toBe('meta')
    expect(plan.some((s) => built.units[s.from - 1].shown.startsWith('==='))).toBe(true)
    expect(plan[plan.length - 1].to).toBe(built.units.length)
  })
})

describe('mergeComments', () => {
  const c = (line: number, message: string) => ({ line, message, severity: 'info' })

  it('joins the shards in order and keeps every comment when none repeats', () => {
    expect(mergeComments([[c(1, 'a'), c(5, 'b')], [c(210, 'c')]])).toEqual({ comments: [c(1, 'a'), c(5, 'b'), c(210, 'c')], duplicates: 0 })
  })

  it('drops a comment that repeats the cited line and the opening of a message, and counts it', () => {
    const merged = mergeComments([[c(7, 'The error is ignored here.')], [c(7, '  the ERROR is ignored here.  ')]])
    expect(merged.comments).toEqual([c(7, 'The error is ignored here.')])
    expect(merged.duplicates).toBe(1)
  })

  it('keeps two comments on the same line that say different things, and the same words on different lines', () => {
    expect(mergeComments([[c(7, 'The error is ignored.'), c(7, 'The name shadows an import.'), c(8, 'The error is ignored.')]]).comments).toHaveLength(3)
  })

  it('keeps an item that is not a comment, for the checks to count as unreadable', () => {
    expect(mergeComments([[null, 'text', { line: 'x' }], [null]]).comments).toHaveLength(4)
  })
})
