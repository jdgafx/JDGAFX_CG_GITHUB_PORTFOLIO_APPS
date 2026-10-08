import { useState } from 'react'
import type { DragEvent } from 'react'

// Drop handling for one image target. The caller spreads dropProps onto the element and
// marks the target as active while dragging is true.
export function useFileDrop(onFile: (file: File) => void, disabled: boolean) {
  const [dragging, setDragging] = useState(false)

  const dropProps = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      if (!disabled) setDragging(true)
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      setDragging(false)
      const file = event.dataTransfer.files[0]
      if (file && !disabled) onFile(file)
    },
  }

  return { dragging, dropProps }
}
