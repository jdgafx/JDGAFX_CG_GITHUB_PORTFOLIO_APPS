import { describe, expect, it } from 'vitest'
import { buildPrPrompt, buildSystemPrompt } from '../../netlify/shared/review'

describe('the pass 1 prompt of a shard', () => {
  const whole = buildSystemPrompt('go', 608, 15)
  const part = buildSystemPrompt('go', 608, 4, { from: 153, to: 304 })

  it('is the plain prompt, unchanged, when there is no range', () => {
    expect(whole).toContain('"line": <integer between 1 and 608>')
    expect(whole).toContain('Read all of it, then divide it into 15 regions')
    expect(whole).not.toContain('read-only context')
  })

  it('names the range, asks for comments in it alone, and keeps the rest of the file as context to read', () => {
    expect(part).toContain('"line": <integer between 153 and 304>')
    expect(part).toContain('lines 153 to 304 only')
    expect(part).toContain('read-only context')
    expect(part).toContain('Divide lines 153 to 304 into 4 regions')
    expect(part).toContain('Only cite lines from 153 to 304')
  })

  it('no longer tells the shard to divide or cite the whole file', () => {
    expect(part).not.toContain('Read all of it, then divide it into')
    expect(part).not.toContain('between 1 and 608')
    expect(part).not.toContain('from 1 to 608')
  })
})

describe('the pull request prompt of a shard', () => {
  const part = buildPrPrompt(900, 40, 4, { from: 301, to: 600 })

  it('names the range, keeps the rest of the diff as read-only context and asks for comments on changed lines in the range', () => {
    expect(part).toContain('"line": <integer between 301 and 600>')
    expect(part).toContain('lines 301 to 600 only')
    expect(part).toContain('read-only context')
    expect(part).toContain('up to 4 comments')
  })

  it('is the plain prompt without a range', () => {
    expect(buildPrPrompt(900, 40, 8)).toContain('"line": <integer between 1 and 900>')
  })
})
