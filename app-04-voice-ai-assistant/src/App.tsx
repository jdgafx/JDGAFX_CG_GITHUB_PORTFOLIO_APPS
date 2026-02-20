import { useRef, useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, Volume2, Loader2, MessageCircle } from 'lucide-react'
import { transcribe, chat } from './lib/api'
import type { Message } from './lib/api'

type AppState = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking'

export default function App() {
  const [appState, setAppState] = useState<AppState>('idle')
  const [messages, setMessages] = useState<Message[]>([])
  const [error, setError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current
    const analyser = analyserRef.current
    if (!canvas || !analyser) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    analyser.getByteFrequencyData(dataArray)

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const barCount = 48
    const barWidth = (canvas.width / barCount) * 0.6
    const gap = (canvas.width / barCount) * 0.4
    const centerY = canvas.height / 2

    for (let i = 0; i < barCount; i++) {
      const dataIndex = Math.floor((i / barCount) * bufferLength)
      const value = dataArray[dataIndex] / 255
      const barHeight = Math.max(4, value * canvas.height * 0.8)

      const x = i * (barWidth + gap) + gap / 2
      const alpha = 0.4 + value * 0.6

      const gradient = ctx.createLinearGradient(0, centerY - barHeight / 2, 0, centerY + barHeight / 2)
      gradient.addColorStop(0, `rgba(167, 139, 250, ${alpha})`)
      gradient.addColorStop(0.5, `rgba(139, 92, 246, ${alpha})`)
      gradient.addColorStop(1, `rgba(109, 40, 217, ${alpha})`)

      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.roundRect(x, centerY - barHeight / 2, barWidth, barHeight, 2)
      ctx.fill()
    }

    animFrameRef.current = requestAnimationFrame(drawWaveform)
  }, [])

  const drawIdle = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const barCount = 48
    const barWidth = (canvas.width / barCount) * 0.6
    const gap = (canvas.width / barCount) * 0.4
    const centerY = canvas.height / 2
    const time = Date.now() / 1000

    for (let i = 0; i < barCount; i++) {
      const wave = Math.sin(i * 0.3 + time * 2) * 0.15 + 0.1
      const barHeight = Math.max(3, wave * canvas.height)
      const x = i * (barWidth + gap) + gap / 2

      ctx.fillStyle = `rgba(139, 92, 246, 0.3)`
      ctx.beginPath()
      ctx.roundRect(x, centerY - barHeight / 2, barWidth, barHeight, 2)
      ctx.fill()
    }

    animFrameRef.current = requestAnimationFrame(drawIdle)
  }, [])

  useEffect(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (appState === 'recording') {
      drawWaveform()
    } else {
      drawIdle()
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [appState, drawWaveform, drawIdle])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
      analyserRef.current = null
    }
  }, [])

  const startRecording = useCallback(async () => {
    setError(null)
    chunksRef.current = []

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamRef.current = stream

    const audioContext = new AudioContext()
    audioContextRef.current = audioContext
    const source = audioContext.createMediaStreamSource(stream)
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    analyserRef.current = analyser

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    const recorder = new MediaRecorder(stream, { mimeType })
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: mimeType })
      setAppState('transcribing')

      let text = ''
      try {
        text = await transcribe(blob)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Transcription failed')
        setAppState('idle')
        return
      }

      if (!text.trim()) {
        setError('No speech detected')
        setAppState('idle')
        return
      }

      const userMessage: Message = { role: 'user', content: text }
      setMessages(prev => [...prev, userMessage])
      setAppState('thinking')

      let response = ''
      try {
        response = await chat(text, messages)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'AI failed')
        setAppState('idle')
        return
      }

      const assistantMessage: Message = { role: 'assistant', content: response }
      setMessages(prev => [...prev, assistantMessage])
      setAppState('speaking')

      const utterance = new SpeechSynthesisUtterance(response)
      utterance.rate = 1.0
      utterance.pitch = 1.0
      utterance.onend = () => setAppState('idle')
      utterance.onerror = () => setAppState('idle')
      speechSynthesis.speak(utterance)
    }

    recorder.start(100)
    setAppState('recording')
  }, [messages])

  const handleMicClick = useCallback(async () => {
    if (appState === 'recording') {
      stopRecording()
    } else if (appState === 'idle') {
      try {
        await startRecording()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Microphone access denied')
        setAppState('idle')
      }
    } else if (appState === 'speaking') {
      speechSynthesis.cancel()
      setAppState('idle')
    }
  }, [appState, startRecording, stopRecording])

  const stateLabel: Record<AppState, string> = {
    idle: 'Tap to speak',
    recording: 'Recording… tap to stop',
    transcribing: 'Transcribing…',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
  }

  const isProcessing = appState === 'transcribing' || appState === 'thinking'

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center" style={{ fontFamily: 'Inter, sans-serif' }}>
      <header className="w-full flex items-center justify-between px-8 py-5 border-b border-zinc-800/50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' }}>
            <Mic size={16} color="white" />
          </div>
          <span className="text-xl font-semibold tracking-tight text-white">VoxAI</span>
        </div>
        <span className="text-xs text-zinc-500 font-mono">Voice AI Assistant</span>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center gap-10 px-6 py-12 w-full max-w-2xl mx-auto">
        <div className="flex flex-col items-center gap-6 w-full">
          <div
            className="relative w-full rounded-2xl overflow-hidden"
            style={{ height: 200, background: 'rgba(139,92,246,0.04)', border: '1px solid rgba(139,92,246,0.15)' }}
          >
            <canvas
              ref={canvasRef}
              width={600}
              height={200}
              className="w-full h-full"
            />
            {isProcessing && (
              <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(9,9,11,0.7)' }}>
                <Loader2 size={32} color="#8b5cf6" className="animate-spin" />
              </div>
            )}
          </div>

          <div className="flex flex-col items-center gap-6">
            <motion.button
              onClick={handleMicClick}
              disabled={isProcessing}
              whileTap={{ scale: 0.94 }}
              className="relative w-20 h-20 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none"
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
                <Volume2 size={28} color="white" />
              ) : appState === 'recording' ? (
                <MicOff size={28} color="white" />
              ) : (
                <Mic size={28} color="white" />
              )}
            </motion.button>

            <AnimatePresence mode="wait">
              <motion.p
                key={appState}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                className="text-sm font-medium"
                style={{ color: appState === 'recording' ? '#f87171' : '#a1a1aa' }}
              >
                {stateLabel[appState]}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="w-full px-4 py-3 rounded-xl text-sm text-red-400"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {messages.length > 0 && (
          <div className="w-full space-y-3">
            <div className="flex items-center gap-2 text-xs text-zinc-500 font-medium uppercase tracking-wider">
              <MessageCircle size={12} />
              Conversation
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin', scrollbarColor: '#3f3f46 transparent' }}>
              <AnimatePresence initial={false}>
                {messages.map((msg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className="max-w-xs px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
                      style={msg.role === 'user' ? {
                        background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                        color: 'white',
                        borderBottomRightRadius: 4,
                      } : {
                        background: '#18181b',
                        color: '#d4d4d8',
                        border: '1px solid #27272a',
                        borderBottomLeftRadius: 4,
                      }}
                    >
                      {msg.content}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>

      <footer className="pb-6 text-center text-xs text-zinc-600">
        Powered by Groq Whisper + Claude
      </footer>
    </div>
  )
}
