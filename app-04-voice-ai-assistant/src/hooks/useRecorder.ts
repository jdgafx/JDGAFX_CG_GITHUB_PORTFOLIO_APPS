import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_RECORDING_MS, isRecordingSupported, pickRecorderMimeType } from '../lib/audio'
import { startBrowserTranscript, type BrowserTranscriptHandle } from '../lib/browser-transcript'

const COUNTDOWN_TICK_MS = 250
const MAX_RECORDING_SECONDS = Math.round(MAX_RECORDING_MS / 1000)

interface RecorderEvents {
  onRecorded: (clip: Blob, readBrowserText: () => string) => void
  onNotice: (message: string) => void
  onFailure: (message: string) => void
}

// Owns the microphone for one recording at a time: the stream, the analyser that
// drives the waveform, the countdown and the automatic stop. The finished clip is
// handed over only after the last chunk has landed.
export function useRecorder(events: RecorderEvents) {
  const [hasMic, setHasMic] = useState(isRecordingSupported())
  const [msLeft, setMsLeft] = useState(MAX_RECORDING_MS)
  const eventsRef = useRef(events)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const browserRef = useRef<BrowserTranscriptHandle | null>(null)
  const stopTimerRef = useRef<number | null>(null)
  const countdownRef = useRef<number | null>(null)

  useEffect(() => {
    eventsRef.current = events
  })

  // The first render already reads isRecordingSupported(), so only the device check is left.
  useEffect(() => {
    if (!isRecordingSupported()) return
    navigator.mediaDevices
      .enumerateDevices()
      .then(devices => setHasMic(devices.some(d => d.kind === 'audioinput')))
      .catch(() => setHasMic(false))
  }, [])

  const clearTimers = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }
    if (countdownRef.current !== null) {
      window.clearInterval(countdownRef.current)
      countdownRef.current = null
    }
  }, [])

  // Releases the mic and the analyser graph. Runs from recorder.onstop, so the
  // final dataavailable chunk has already landed before the stream dies.
  const releaseAudio = useCallback(() => {
    clearTimers()
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    analyserRef.current = null
  }, [clearTimers])

  const stop = useCallback(() => {
    clearTimers()
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    } else {
      releaseAudio()
    }
  }, [clearTimers, releaseAudio])

  const start = useCallback(async () => {
    if (!isRecordingSupported()) {
      throw Object.assign(new Error('Recording unsupported'), { name: 'NotSupportedError' })
    }
    const mimeType = pickRecorderMimeType()
    if (mimeType === null) {
      throw Object.assign(new Error('No supported recording format'), { name: 'NotSupportedError' })
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamRef.current = stream
    browserRef.current = startBrowserTranscript()
    chunksRef.current = []

    try {
      const audioContext = new AudioContext()
      audioContextRef.current = audioContext
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      audioContext.createMediaStreamSource(stream).connect(analyser)
      analyserRef.current = analyser

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder

      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        releaseAudio()
        eventsRef.current.onFailure('Recording stopped unexpectedly. Try again.')
      }
      recorder.onstop = () => {
        browserRef.current?.stop()
        const clip = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' })
        chunksRef.current = []
        const browser = browserRef.current
        browserRef.current = null
        releaseAudio()
        eventsRef.current.onRecorded(clip, () => browser?.getText() ?? '')
      }

      recorder.start(100)
      setMsLeft(MAX_RECORDING_MS)
      const deadline = Date.now() + MAX_RECORDING_MS
      countdownRef.current = window.setInterval(() => setMsLeft(deadline - Date.now()), COUNTDOWN_TICK_MS)
      stopTimerRef.current = window.setTimeout(() => {
        eventsRef.current.onNotice(`Reached the ${MAX_RECORDING_SECONDS} second limit. Transcribing what was recorded.`)
        stop()
      }, MAX_RECORDING_MS)
    } catch (err) {
      browserRef.current?.stop()
      browserRef.current = null
      releaseAudio()
      throw err
    }
  }, [releaseAudio, stop])

  const markNoMic = useCallback(() => setHasMic(false), [])

  // Unmount: stop without handing the clip to a page that is gone.
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current
      if (recorder) {
        recorder.onstop = null
        if (recorder.state !== 'inactive') recorder.stop()
      }
      browserRef.current?.stop()
      releaseAudio()
    }
  }, [releaseAudio])

  return { hasMic, msLeft, analyserRef, start, stop, markNoMic }
}
