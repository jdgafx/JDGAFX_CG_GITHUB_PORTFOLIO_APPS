import { describe, expect, it } from 'vitest'
import { diffContext, fileContext } from '../../src/lib/context'
import { parsePatch } from '../../netlify/shared/diff'

describe('fileContext', () => {
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`)

  it('shows four lines either side of the cited one, with the file line numbers', () => {
    const ctx = fileContext(lines, 10)
    expect(ctx.map((l) => l.n)).toEqual(['6', '7', '8', '9', '10', '11', '12', '13', '14'])
    expect(ctx.filter((l) => l.cited).map((l) => l.text)).toEqual(['line 10'])
  })

  it('stops at the edges of the file', () => {
    expect(fileContext(lines, 2).map((l) => l.n)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(fileContext(lines, 20).map((l) => l.n)).toEqual(['16', '17', '18', '19', '20'])
  })
})

describe('diffContext', () => {
  // Line 1 is the file header, as buildDiff numbers it; then the hunk header and the real requests#6963 lines.
  const units = [
    { text: '', shown: '=== utils.py (modified)', kind: 'meta' as const, file: 'utils.py', newLine: null, oldLine: null },
    ...parsePatch('utils.py', '@@ -219,5 +219,4 @@\n         netrc_path = None\n \n         for f in netrc_locations:\n-            try:\n-                loc = os.path.expanduser(f)\n+            loc = os.path.expanduser(f)\n             if os.path.exists(loc):'),
  ]

  it('numbers removed lines by the old side and others by the new side, and leaves out headers', () => {
    const ctx = diffContext(units, 8)
    expect(ctx.map((l) => [l.kind, l.n])).toEqual([
      ['ctx', '220'], ['ctx', '221'], ['del', '222'], ['del', '223'], ['add', '222'], ['ctx', '223'],
    ])
    expect(ctx.find((l) => l.cited)).toMatchObject({ kind: 'add', text: '            loc = os.path.expanduser(f)' })
  })
})
