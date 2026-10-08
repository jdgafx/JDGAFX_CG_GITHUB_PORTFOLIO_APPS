import { useEffect, type RefObject } from 'react'
import { drawWaveform } from '../lib/waveform'

// Keeps the canvas in step with the microphone. Levels animate only while
// recording; otherwise the bars stay still and redraw only when the canvas resizes.
export function useWaveform(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  analyserRef: RefObject<AnalyserNode | null>,
  live: boolean,
): void {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = () => {
      const analyser = live ? analyserRef.current : null
      if (analyser) {
        const levels = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(levels)
        drawWaveform(canvas, levels)
      } else {
        drawWaveform(canvas, null)
      }
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)

    let frame = 0
    const loop = () => {
      draw()
      frame = window.requestAnimationFrame(loop)
    }
    if (live) frame = window.requestAnimationFrame(loop)

    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [canvasRef, analyserRef, live])
}
