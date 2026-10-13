import { describe, expect, it } from 'vitest'
import { readCredit } from '../../src/lib/credit'
import { CREDIT } from '../helpers/recording'

describe('the credit read back from a recorded request', () => {
  it('accepts exactly what the page sends, and copies it', () => {
    const out = readCredit({ ...CREDIT, extra: 'dropped' })
    expect(out).toEqual(CREDIT)
    expect(out).not.toHaveProperty('extra')
  })

  it('accepts a credit with no licence address', () => {
    expect(readCredit({ ...CREDIT, licenceUrl: null })?.licenceUrl).toBeNull()
  })

  it('refuses addresses off the Commons hosts, other schemes and non-bitmap types', () => {
    const bad = [
      { pageUrl: 'https://evil.example/wiki/File:X.jpg' },
      { pageUrl: 'http://commons.wikimedia.org/wiki/File:X.jpg' },
      { thumbUrl: 'https://evil.example/x.jpg' },
      { thumbUrl: 'javascript:alert(1)' },
      { licenceUrl: 'javascript:alert(1)' },
      { mime: 'image/svg+xml' },
      { width: -1 },
      { height: 1.5 },
      { title: '' },
      { author: 'x'.repeat(401) },
      { licence: 7 },
    ]
    for (const over of bad) expect(readCredit({ ...CREDIT, ...over }), JSON.stringify(over)).toBeNull()
  })

  it('refuses anything that is not an object', () => {
    for (const value of [null, undefined, 'x', 5, []]) expect(readCredit(value)).toBeNull()
  })
})
