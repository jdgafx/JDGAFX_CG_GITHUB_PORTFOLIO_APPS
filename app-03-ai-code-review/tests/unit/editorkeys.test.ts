import { describe, expect, it } from 'vitest'
import { editorKey } from '../../src/lib/editorkeys'

describe('editorKey', () => {
  it('returns to the comment on Escape while a jump note is open, and does nothing on Escape otherwise', () => {
    expect(editorKey('Escape', false, true)).toBe('back')
    expect(editorKey('Escape', false, false)).toBeNull()
  })

  it('indents on Tab only when no jump note is open, so Tab can reach "Back to comment"', () => {
    expect(editorKey('Tab', false, false)).toBe('indent')
    expect(editorKey('Tab', false, true)).toBeNull()
  })

  it('never captures Shift+Tab or other keys', () => {
    expect(editorKey('Tab', true, false)).toBeNull()
    expect(editorKey('Tab', true, true)).toBeNull()
    expect(editorKey('a', false, true)).toBeNull()
  })
})
