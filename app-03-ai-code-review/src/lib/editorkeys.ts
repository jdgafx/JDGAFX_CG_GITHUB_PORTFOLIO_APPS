export type EditorKeyAction = 'back' | 'indent' | null

/**
 * What a key does in the editor. Escape returns to the comment while a jump note is open. Tab indents only when no jump note
 * is open: with one open, Tab must leave the editor so a keyboard user can reach the "Back to comment" button. Shift+Tab
 * always leaves.
 */
export function editorKey(key: string, shiftKey: boolean, jumpOpen: boolean): EditorKeyAction {
  if (key === 'Escape' && jumpOpen) return 'back'
  if (key === 'Tab' && !shiftKey && !jumpOpen) return 'indent'
  return null
}
