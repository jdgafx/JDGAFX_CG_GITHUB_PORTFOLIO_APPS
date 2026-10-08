// Canvas bar meter. Bars are drawn in CSS pixels on a backing store scaled by
// devicePixelRatio, and the store is re-synced to the element's box on every draw.

const BAR_COUNT = 48
const FALLBACK_ACCENT = '#3557d6'

// Resizes the backing store to match the element's CSS box at the current
// device pixel ratio. Returns false when the canvas has no layout yet.
function syncCanvasSize(canvas: HTMLCanvasElement): boolean {
  const cssWidth = canvas.clientWidth
  const cssHeight = canvas.clientHeight
  if (cssWidth === 0 || cssHeight === 0) return false

  const dpr = window.devicePixelRatio || 1
  const width = Math.round(cssWidth * dpr)
  const height = Math.round(cssHeight * dpr)
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  return true
}

// Draws the live frequency `levels` from an AnalyserNode, or with no levels a
// still, idle row of bars. The colour comes from the --ds-accent token, so the
// meter follows the light and dark themes.
export function drawWaveform(canvas: HTMLCanvasElement, levels: Uint8Array | null): void {
  if (!syncCanvasSize(canvas)) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const accent = getComputedStyle(canvas).getPropertyValue('--ds-accent').trim() || FALLBACK_ACCENT
  ctx.fillStyle = accent

  const slot = width / BAR_COUNT
  const barWidth = slot * 0.6
  const centerY = height / 2
  for (let i = 0; i < BAR_COUNT; i++) {
    const value = levels
      ? levels[Math.floor((i / BAR_COUNT) * levels.length)] / 255
      : 0.15 + 0.1 * Math.abs(Math.sin(i * 0.45))
    const barHeight = Math.max(3, value * height * 0.9)
    ctx.globalAlpha = levels ? 0.35 + value * 0.65 : 0.35
    ctx.beginPath()
    ctx.roundRect(i * slot + (slot - barWidth) / 2, centerY - barHeight / 2, barWidth, barHeight, 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}
