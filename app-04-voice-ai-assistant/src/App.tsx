import { useRef, useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Mic, MicOff, Volume2, Loader2 } from 'lucide-react'
import { transcribe, chat } from './lib/api'
import type { ChatMessage, Message } from './lib/api'
import Header from './components/Header'
import ErrorBanner from './components/ErrorBanner'
import Conversation from './components/Conversation'
import MessageInput from './components/MessageInput'
import {
  MAX_RECORDING_MS,
  createAudioContext,
  isRecordingSupported,
  micErrorMessage,
  pickRecorderMimeType,
} from './lib/audio'
import { cancelSpeech, speak, type SpeakHandle } from './lib/speech'
import { isLikelySilence } from './lib/transcript'
import { drawActiveWaveform, drawIdleWaveform } from './lib/waveform'

type AppState = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking'

const MAX_HISTORY_MESSAGES = 20
const COUNTDOWN_TICK_MS = 250
const MAX_RECORDING_SECONDS = Math.round(MAX_RECORDING_MS / 1000)

let messageCounter = 0
function newMessage(role: Message['role'], content: string): ChatMessage {
  messageCounter += 1
  return { id: `${role}-${messageCounter}`, role, content }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('idle')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [textInput, setTextInput] = useState('')
  const [hasMic, setHasMic] = useState(isRecordingSupported())
  const [msLeft, setMsLeft] = useState(MAX_RECORDING_MS)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const messagesRef = useRef<ChatMessage[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const speakRef = useRef<SpeakHandle | null>(null)
  const stopTimerRef = useRef<number | null>(null)
  const countdownRef = useRef<number | null>(null)

  // Keep messagesRef in sync so recorder.onstop always has current messages
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const clearRecordingTimers = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }
    if (countdownRef.current !== null) {
      window.clearInterval(countdownRef.current)
      countdownRef.current = null
    }
  }, [])

  // Releases the mic and the analyser graph. Called from recorder.onstop so the
  // final `dataavailable` chunk has already landed before the stream dies.
  const releaseAudio = useCallback(() => {
    clearRecordingTimers()
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    analyserRef.current = null
  }, [clearRecordingTimers])

  // Cleanup on unmount: stop speech, recording, in-flight requests
  useEffect(() => {
    return () => {
      speakRef.current?.cancel()
      cancelSpeech()
      abortRef.current?.abort()
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      releaseAudio()
    }
  }, [releaseAudio])

  useEffect(() => {
    if (!isRecordingSupported()) {
      setHasMic(false)
      return
    }
    navigator.mediaDevices
      .enumerateDevices()
      .then(devices => setHasMic(devices.some(d => d.kind === 'audioinput')))
      .catch(() => setHasMic(false))
  }, [])

  // Waveform loop. Every frame re-syncs the backing store, so a resize or a
  // move to a different-DPR screen is picked up automatically; the loop is
  // parked while the tab is hidden.
  useEffect(() => {
    let frame = 0

    const paint = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      if (appState === 'recording' && analyserRef.current) {
        drawActiveWaveform(canvas, analyserRef.current)
      } else {
        drawIdleWaveform(canvas)
      }
    }

    const render = () => {
      paint()
      frame = window.requestAnimationFrame(render)
    }

    const start = () => {
      if (!frame) frame = window.requestAnimationFrame(render)
    }
    const stop = () => {
      if (frame) {
        window.cancelAnimationFrame(frame)
        frame = 0
      }
    }
    const onVisibility = () => (document.hidden ? stop() : start())

    // Paint once up front: a hidden tab (or a browser that withholds frames)
    // would otherwise leave the canvas at its unsized default.
    paint()
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)

    const canvas = canvasRef.current
    const observer = canvas ? new ResizeObserver(() => paint()) : null
    if (canvas && observer) observer.observe(canvas)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      observer?.disconnect()
      stop()
    }
  }, [appState])

  const speakResponse = useCallback((text: string) => {
    setAppState('speaking')
    speakRef.current = speak(text, {
      onEnd: () => setAppState('idle'),
      onError: message => {
        setError(message)
        setAppState('idle')
      },
    })
  }, [])

  // Single path for "user said something" — used by both the mic and the text
  // box so history trimming, error handling and playback behave identically.
  const sendAndSpeak = useCallback(
    async (text: string) => {
      const updated = [...messagesRef.current, newMessage('user', text)]
      messagesRef.current = updated
      setMessages(updated)
      setAppState('thinking')

      const controller = new AbortController()
      abortRef.current = controller

      try {
        // Send trimmed history to avoid token overflow
        const historyToSend = updated
          .slice(-MAX_HISTORY_MESSAGES)
          .slice(0, -1)
          .map(({ role, content }) => ({ role, content }))
        const response = await chat(text, historyToSend, controller.signal)
        setMessages(prev => [...prev, newMessage('assistant', response)])
        speakResponse(response)
      } catch (err) {
        if (isAbort(err)) {
          setAppState('idle')
          return
        }
        setError(err instanceof Error ? err.message : 'The assistant failed. Try again.')
        setAppState('idle')
      } finally {
        abortRef.current = null
      }
    },
    [speakResponse],
  )

  const handleRecording = useCallback(
    async (blob: Blob) => {
      setAppState('transcribing')
      const controller = new AbortController()
      abortRef.current = controller

      let text = ''
      try {
        text = await transcribe(blob, controller.signal)
      } catch (err) {
        if (isAbort(err)) {
          setAppState('idle')
          return
        }
        setError(err instanceof Error ? err.message : 'Transcription failed. Try again.')
        setAppState('idle')
        return
      } finally {
        abortRef.current = null
      }

      if (!text.trim() || isLikelySilence(text)) {
        setError('No speech detected. Try speaking louder or closer to the microphone.')
        setAppState('idle')
        return
      }

      await sendAndSpeak(text)
    },
    [sendAndSpeak],
  )

  const stopRecording = useCallback(() => {
    clearRecordingTimers()
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    } else {
      releaseAudio()
      setAppState('idle')
    }
  }, [clearRecordingTimers, releaseAudio])

  const startRecording = useCallback(async () => {
    setError(null)
    chunksRef.current = []

    if (!isRecordingSupported()) {
      throw Object.assign(new Error('Recording unsupported'), { name: 'NotSupportedError' })
    }

    const mimeType = pickRecorderMimeType()
    if (mimeType === null) {
      throw Object.assign(new Error('No supported recording format'), { name: 'NotSupportedError' })
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamRef.current = stream

    try {
      const audioContext = createAudioContext()
      audioContextRef.current = audioContext
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      audioContext.createMediaStreamSource(stream).connect(analyser)
      analyserRef.current = analyser

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onerror = () => {
        releaseAudio()
        setError('Recording stopped unexpectedly. Try again.')
        setAppState('idle')
      }

      // Teardown lives here so the final dataavailable chunk is captured before
      // the stream and the audio graph are released.
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        chunksRef.current = []
        releaseAudio()
        void handleRecording(blob)
      }

      recorder.start(100)
      setAppState('recording')
      setMsLeft(MAX_RECORDING_MS)

      const deadline = Date.now() + MAX_RECORDING_MS
      countdownRef.current = window.setInterval(
        () => setMsLeft(deadline - Date.now()),
        COUNTDOWN_TICK_MS,
      )
      stopTimerRef.current = window.setTimeout(() => {
        setError(`Reached the ${MAX_RECORDING_SECONDS} second limit — transcribing what was recorded.`)
        stopRecording()
      }, MAX_RECORDING_MS)
    } catch (err) {
      releaseAudio()
      throw err
    }
  }, [handleRecording, releaseAudio, stopRecording])

  const handleMicClick = useCallback(async () => {
    if (appState === 'recording') {
      stopRecording()
      return
    }
    if (appState === 'speaking') {
      speakRef.current?.cancel()
      speakRef.current = null
      setAppState('idle')
      return
    }
    if (appState !== 'idle') return

    try {
      await startRecording()
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      if (name === 'NotFoundError' || name === 'NotSupportedError') setHasMic(false)
      setError(micErrorMessage(err))
      setAppState('idle')
    }
  }, [appState, startRecording, stopRecording])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setAppState('idle')
  }, [])

  const handleTextSubmit = useCallback(() => {
    const text = textInput.trim()
    if (!text || appState !== 'idle') return
    setTextInput('')
    setError(null)
    void sendAndSpeak(text)
  }, [textInput, appState, sendAndSpeak])

  const handleClear = useCallback(() => {
    speakRef.current?.cancel()
    speakRef.current = null
    abortRef.current?.abort()
    abortRef.current = null
    messagesRef.current = []
    setMessages([])
    setError(null)
    setAppState('idle')
  }, [])

  const isProcessing = appState === 'transcribing' || appState === 'thinking'
  const micDisabled = isProcessing || (!hasMic && appState === 'idle')

  const stateLabel: Record<AppState, string> = {
    idle: hasMic ? 'Tap to speak' : 'Type a message to start',
    recording: `Recording… tap to stop · ${formatCountdown(msLeft)} left`,
    transcribing: 'Transcribing…',
    thinking: 'Thinking…',
    speaking: 'Speaking… tap to stop',
  }

  const micTitle =
    appState === 'recording'
      ? 'Stop recording and transcribe'
      : appState === 'speaking'
        ? 'Stop the spoken response'
        : hasMic
          ? `Start recording your question (${MAX_RECORDING_SECONDS} second maximum)`
          : 'No microphone available — use the text box below'

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center" style={{ fontFamily: 'Lexend, sans-serif' }}>
      <Header />

      <main className="flex-1 flex flex-col items-center justify-center gap-10 px-6 py-12 w-full max-w-2xl mx-auto">
        <div className="flex flex-col items-center gap-6 w-full">
          <div
            className="relative w-full rounded-2xl overflow-hidden"
            style={{ height: 200, background: 'rgba(139,92,246,0.04)', border: '1px solid rgba(139,92,246,0.15)' }}
            title="Live microphone level while recording"
          >
            <canvas ref={canvasRef} className="w-full h-full" aria-hidden="true" />
            {isProcessing && (
              <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(9,9,11,0.7)' }}>
                <Loader2 size={32} color="#8b5cf6" className="animate-spin" aria-hidden="true" />
              </div>
            )}
          </div>

          <div className="flex flex-col items-center gap-6">
            <motion.button
              type="button"
              onClick={handleMicClick}
              disabled={micDisabled}
              whileTap={{ scale: 0.94 }}
              aria-label={micTitle}
              title={micTitle}
              className="relative w-20 h-20 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
              style={{
                background: appState === 'recording'
                  ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                  : 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                boxShadow: appState === 'recording'
                  ? '0 0 0 0 rgba(239,68,68,0.4), 0 8px 32px rgba(239,68,68,0.4)'
                  : '0 0 0 0 rgba(139,92,246,0.4), 0 8px 32px rgba(139,92,246,0.3)',
              }}
            >
              {appState === 'recording' && (
                <motion.div
                  className="absolute inset-0 rounded-full"
                  style={{ background: 'rgba(239,68,68,0.3)' }}
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              )}
              {appState === 'speaking' ? (
                <Volume2 size={28} color="white" aria-hidden="true" />
              ) : appState === 'recording' ? (
                <MicOff size={28} color="white" aria-hidden="true" />
              ) : (
                <Mic size={28} color="white" aria-hidden="true" />
              )}
            </motion.button>

            <div className="flex flex-col items-center gap-3">
              <p
                aria-live="polite"
                title="Current assistant status"
                className="text-sm font-medium"
                style={{ color: appState === 'recording' ? '#f87171' : '#a1a1aa', margin: 0 }}
              >
                {stateLabel[appState]}
              </p>

              {isProcessing && (
                <button
                  type="button"
                  onClick={handleCancel}
                  aria-label="Cancel the request in progress"
                  title="Cancel the request in progress"
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                  style={{ background: '#18181b', border: '1px solid #3f3f46' }}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>

        <MessageInput
          value={textInput}
          onChange={setTextInput}
          onSubmit={handleTextSubmit}
          disabled={appState !== 'idle'}
          hasMic={hasMic}
        />

        <ErrorBanner message={error} onDismiss={() => setError(null)} />

        <Conversation messages={messages} onClear={handleClear} />
      </main>

      <footer className="pb-6 text-center text-xs text-zinc-600">
        Authored by Christopher Gentile / CGDarkstardev1 / NewDawn AI
      </footer>
    </div>
  )
}
