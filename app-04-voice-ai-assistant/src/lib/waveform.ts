// Canvas waveform rendering. All drawing happens in CSS pixels; the backing
// store is scaled by devicePixelRatio so the bars stay crisp on HiDPI screens
// and the canvas re-syncs whenever its box changes size.

const BAR_COUNT = 48

interface Layout {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  barWidth: number
  gap: number
  centerY: number
}

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

function layout(canvas: HTMLCanvasElement): Layout | null {
  if (!syncCanvasSize(canvas)) return null
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const width = canvas.clientWidth
  const height = canvas.clientHeight
  ctx.clearRect(0, 0, width, height)

  return {
    ctx,
    width,
    height,
    barWidth: (width / BAR_COUNT) * 0.6,
    gap: (width / BAR_COUNT) * 0.4,
    centerY: height / 2,
  }
}

function drawBar(l: Layout, index: number, barHeight: number, fill: string | CanvasGradient): void {
  const x = index * (l.barWidth + l.gap) + l.gap / 2
  l.ctx.fillStyle = fill
  l.ctx.beginPath()
  l.ctx.roundRect(x, l.centerY - barHeight / 2, l.barWidth, barHeight, 2)
  l.ctx.fill()
}

export function drawActiveWaveform(canvas: HTMLCanvasElement, analyser: AnalyserNode): void {
  const l = layout(canvas)
  if (!l) return

  const bufferLength = analyser.frequencyBinCount
  const dataArray = new Uint8Array(bufferLength)
  analyser.getByteFrequencyData(dataArray)

  for (let i = 0; i < BAR_COUNT; i++) {
    const value = dataArray[Math.floor((i / BAR_COUNT) * bufferLength)] / 255
    const barHeight = Math.max(4, value * l.height * 0.8)
    const alpha = 0.4 + value * 0.6

    const gradient = l.ctx.createLinearGradient(
      0,
      l.centerY - barHeight / 2,
      0,
      l.centerY + barHeight / 2,
    )
    gradient.addColorStop(0, `rgba(167, 139, 250, ${alpha})`)
    gradient.addColorStop(0.5, `rgba(139, 92, 246, ${alpha})`)
    gradient.addColorStop(1, `rgba(109, 40, 217, ${alpha})`)

    drawBar(l, i, barHeight, gradient)
  }
}

export function drawIdleWaveform(canvas: HTMLCanvasElement): void {
  const l = layout(canvas)
  if (!l) return

  const time = Date.now() / 1000
  for (let i = 0; i < BAR_COUNT; i++) {
    const wave = Math.sin(i * 0.3 + time * 2) * 0.15 + 0.1
    drawBar(l, i, Math.max(3, wave * l.height), 'rgba(139, 92, 246, 0.3)')
  }
}
