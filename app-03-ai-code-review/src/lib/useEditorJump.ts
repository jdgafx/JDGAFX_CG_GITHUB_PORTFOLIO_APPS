import { useEffect, type RefObject } from 'react'
import { LINE_HEIGHT } from '../constants'
import type { ReviewComment } from '../types'

interface EditorJump {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  lineNumbersRef: RefObject<HTMLDivElement | null>
  highlightedLine: number | null
  jump: ReviewComment | null
  code: string
}

/** Keeps the editor on the line a comment is about: the line is scrolled to the middle, and a jump puts the caret on it. */
export function useEditorJump({ textareaRef, lineNumbersRef, highlightedLine, jump, code }: EditorJump): void {
  useEffect(() => {
    if (highlightedLine === null) return
    const el = textareaRef.current
    if (!el) return
    const centered = (highlightedLine - 1) * LINE_HEIGHT - el.clientHeight / 2 + LINE_HEIGHT / 2
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
    const next = Math.min(Math.max(0, centered), maxScroll)
    el.scrollTop = next
    el.scrollLeft = 0
    if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = next
  }, [highlightedLine, textareaRef, lineNumbersRef])

  // A jump from a comment lands in the editor: focus moves there with the caret at the start of that line.
  useEffect(() => {
    if (!jump) return
    const el = textareaRef.current
    if (!el) return
    const start = code.split('\n').slice(0, jump.line - 1).reduce((n, l) => n + l.length + 1, 0)
    el.closest('.editor-card')?.scrollIntoView({ block: 'center' })
    el.focus({ preventScroll: true })
    el.setSelectionRange(start, start)
    // Placing the caret can scroll a long line sideways; the line must start at the left edge so its text is readable.
    el.scrollLeft = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new jump moves focus, not each keystroke
  }, [jump])
}
