// Pure geometry for the region box. A box is four fractions of the picture (0 to 1), so it stays
// correct at any display size and is turned into source pixels only when the crop is cut.

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

/** Smallest side a box may have, as a share of the picture. Below this a drag is treated as a click. */
export const MIN_SIDE = 0.03
/** One arrow key press moves or resizes by this share of the picture. */
export const KEY_STEP = 0.02
/** A crop with a short side under this many pixels is flagged: the model may not be able to read it. */
export const SMALL_CROP_PX = 48

export const DEFAULT_BOX: Box = { x: 0.35, y: 0.35, w: 0.3, h: 0.3 }

const unit = (value: number): number => Math.min(1, Math.max(0, value))

/** Keeps a box inside the picture and no smaller than MIN_SIDE. */
export function clampBox(box: Box): Box {
  const w = Math.min(1, Math.max(MIN_SIDE, box.w))
  const h = Math.min(1, Math.max(MIN_SIDE, box.h))
  return { x: Math.min(1 - w, Math.max(0, box.x)), y: Math.min(1 - h, Math.max(0, box.y)), w, h }
}

/** The box spanned by two corners, in any order. A drag smaller than MIN_SIDE on both sides is not a box. */
export function boxFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Box | null {
  const x0 = unit(Math.min(a.x, b.x))
  const y0 = unit(Math.min(a.y, b.y))
  const x1 = unit(Math.max(a.x, b.x))
  const y1 = unit(Math.max(a.y, b.y))
  if (x1 - x0 < MIN_SIDE && y1 - y0 < MIN_SIDE) return null
  return clampBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
}

export function moveBox(box: Box, dx: number, dy: number): Box {
  return clampBox({ ...box, x: box.x + dx, y: box.y + dy })
}

/** Grows or shrinks from the top-left corner, which stays put unless the box would leave the picture. */
export function resizeBox(box: Box, dw: number, dh: number): Box {
  const w = Math.min(1 - box.x, Math.max(MIN_SIDE, box.w + dw))
  const h = Math.min(1 - box.y, Math.max(MIN_SIDE, box.h + dh))
  return clampBox({ ...box, w, h })
}

/** Arrow keys move the box; with Shift they resize it (right and down grow, left and up shrink). Other keys return null. */
export function keyedBox(box: Box, key: string, shift: boolean): Box | null {
  const dx = key === 'ArrowRight' ? KEY_STEP : key === 'ArrowLeft' ? -KEY_STEP : 0
  const dy = key === 'ArrowDown' ? KEY_STEP : key === 'ArrowUp' ? -KEY_STEP : 0
  if (dx === 0 && dy === 0) return null
  return shift ? resizeBox(box, dx, dy) : moveBox(box, dx, dy)
}

/** Where a pointer is on the picture, as fractions. Clamped, so a drag that leaves the frame stops at its edge. */
export function pointerFraction(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  return { x: unit((clientX - rect.left) / rect.width), y: unit((clientY - rect.top) / rect.height) }
}

/** The whole-pixel rectangle of the source picture a box covers. Never empty, never outside the picture. */
export function cropRect(box: Box, sourceWidth: number, sourceHeight: number): PixelRect {
  const x = Math.min(sourceWidth - 1, Math.round(box.x * sourceWidth))
  const y = Math.min(sourceHeight - 1, Math.round(box.y * sourceHeight))
  const width = Math.max(1, Math.min(sourceWidth - x, Math.round(box.w * sourceWidth)))
  const height = Math.max(1, Math.min(sourceHeight - y, Math.round(box.h * sourceHeight)))
  return { x, y, width, height }
}

export function isSmallCrop(rect: PixelRect): boolean {
  return Math.min(rect.width, rect.height) < SMALL_CROP_PX
}

/** The edge scale to try next when an encoded image is over the byte limit. 1 means it already fits. */
export function shrinkFactor(bytes: number, limit: number): number {
  if (bytes <= limit) return 1
  return Math.min(0.95, Math.max(0.2, Math.sqrt(limit / bytes) * 0.9))
}

/** Percent strings for the overlay, which positions the box in the picture's own units. */
export function boxStyle(box: Box): { left: string; top: string; width: string; height: string } {
  const pct = (value: number) => `${(value * 100).toFixed(2)}%`
  return { left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h) }
}

export const regionTag = (index: number): string => `R${index}`

export function describeRect(rect: PixelRect): string {
  return `${rect.width.toLocaleString('en-US')} × ${rect.height.toLocaleString('en-US')} px`
}
