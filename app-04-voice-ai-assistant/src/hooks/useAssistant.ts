import { useCallback, useEffect, useRef, useState } from 'react'
import {
  RunError,
  chat,
  transcribe,
  type ChatMessage,
  type EncodedAudio,
  type Message,
  type StepStatus,
  type TraceStep,
  type Usage,
} from '../lib/api'
import { NoSpeechError, encodeForUpload, micErrorMessage } from '../lib/audio'
import { UserFacingError } from '../lib/errors'
import { historyFor, markUnsent } from '../lib/history'
import { cancelSpeech, isSpeechAvailable, speak, type SpeakHandle } from '../lib/speech'
import { isLikelySilence } from '../lib/transcript'
import { useRecorder } from './useRecorder'

export type AppState = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking'

// The latest run, as the run card shows it.
export interface RunRecord {
  id: number
  steps: TraceStep[]
  model?: string
  usage?: Usage
  totalMs?: number
  error?: string
}

// Ends the speech step exactly once: finished, failed or stopped.
type SpeakFinisher = (status: StepStatus, detail: string, message?: string) => void

const SILENCE_MESSAGE = 'No speech detected. Try speaking louder or closer to the microphone.'
const ASSISTANT_FAILED = 'The assistant failed. Try again in a moment.'
const UNEXPECTED = 'Something went wrong. Try again.'

let messageCounter = 0
function newMessage(role: Message['role'], content: string): ChatMessage {
  messageCounter += 1
  return { id: `${role}-${messageCounter}`, role, content }
}

let runCounter = 0

function step(name: string, status: StepStatus, ms: number, detail: string): TraceStep {
  return { name, status, ms, detail }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

// Only copy written for the user reaches the screen. Any other error gets the fallback.
function messageOf(err: unknown, fallback: string): string {
  return err instanceof UserFacingError && err.message ? err.message : fallback
}

// Owns the conversation and one run at a time: voice (record, transcribe, ask,
// speak) or typed (ask, speak). Every run leaves a step list for the run card.
export function useAssistant() {
  const [appState, setAppState] = useState<AppState>('idle')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<RunRecord | null>(null)
  const messagesRef = useRef<ChatMessage[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const speakRef = useRef<SpeakHandle | null>(null)
  const finishSpeakRef = useRef<SpeakFinisher | null>(null)
  const startingRef = useRef(false)

  const commitMessages = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next
    setMessages(next)
  }, [])

  const failRun = useCallback((run: RunRecord, message: string) => {
    setLastRun({ ...run, error: message })
    setError(message)
    setAppState('idle')
  }, [])

  // A failure before any run exists (microphone, recorder) still gets a run card,
  // so the failed step is marked the same way as every other failure.
  const failWithStep = useCallback((name: string, message: string) => {
    runCounter += 1
    setLastRun({ id: runCounter, steps: [step(name, 'failed', 0, message)] })
    setError(message)
    setAppState('idle')
  }, [])

  // Reads the reply aloud and records the speak step on the run it belongs to.
  const speakReply = useCallback((runId: number, text: string) => {
    const addStep = (speakStep: TraceStep) =>
      setLastRun(prev => (prev?.id === runId ? { ...prev, steps: [...prev.steps, speakStep] } : prev))

    if (!isSpeechAvailable()) {
      addStep(step('speak reply', 'skipped', 0, 'This browser has no voice output, so the reply is shown as text'))
      setAppState('idle')
      return
    }

    setAppState('speaking')
    const started = Date.now()
    let finished = false
    const finish: SpeakFinisher = (status, detail, message) => {
      if (finished) return
      finished = true
      finishSpeakRef.current = null
      addStep(step('speak reply', status, Date.now() - started, detail))
      if (message) setError(message)
      setAppState('idle')
    }
    finishSpeakRef.current = finish
    speakRef.current = speak(text, {
      // speech.ts ends quietly, and marks speech unavailable, when no voice is installed.
      onEnd: () =>
        isSpeechAvailable()
          ? finish('ok', 'Read aloud by the browser')
          : finish('skipped', 'No voice is installed in this browser, so the reply is shown as text'),
      onError: message => finish('failed', message, message),
    })
  }, [])

  const stopSpeaking = useCallback(() => {
    finishSpeakRef.current?.('skipped', 'Stopped by you')
    speakRef.current?.cancel()
    speakRef.current = null
  }, [])

  // The model turn: send the question with recent history, record the model
  // steps, then read the reply aloud. `serverMs` is the time already spent on
  // the server for this run (speech to text, for a voice question).
  const askAndSpeak = useCallback(
    async (text: string, runId: number, steps: TraceStep[], serverMs: number, controller: AbortController) => {
      const history = historyFor(messagesRef.current)
      const question = newMessage('user', text)
      commitMessages([...messagesRef.current, question])
      setAppState('thinking')
      const started = Date.now()
      try {
        const result = await chat(text, history, controller.signal)
        steps.push(...result.trace)
        commitMessages([...messagesRef.current, { ...newMessage('assistant', result.text), model: result.model }])
        setLastRun({
          id: runId,
          steps: [...steps],
          model: result.model,
          usage: result.usage,
          totalMs: serverMs + (result.totalMs ?? 0),
        })
        speakReply(runId, result.text)
      } catch (err) {
        if (isAbort(err)) {
          commitMessages(markUnsent(messagesRef.current, question.id, 'You cancelled it.'))
          steps.push(step('model call', 'skipped', Date.now() - started, 'Cancelled by you'))
          setLastRun({ id: runId, steps: [...steps] })
          setAppState('idle')
          return
        }
        const message = messageOf(err, ASSISTANT_FAILED)
        commitMessages(markUnsent(messagesRef.current, question.id, message))
        if (err instanceof RunError) {
          steps.push(...err.trace)
        } else {
          steps.push(step('model call', 'failed', Date.now() - started, message))
        }
        const totalMs = err instanceof RunError && err.totalMs !== undefined ? serverMs + err.totalMs : undefined
        failRun({ id: runId, steps: [...steps], totalMs }, message)
      }
    },
    [commitMessages, failRun, speakReply],
  )

  // Voice path: encode the clip, transcribe it (falling back to the browser's own
  // recognition if the server cannot), then ask the model.
  const handleRecorded = useCallback(
    async (clip: Blob, readBrowserText: () => string) => {
      runCounter += 1
      const runId = runCounter
      const steps: TraceStep[] = []
      const controller = new AbortController()
      abortRef.current = controller
      setAppState('transcribing')
      // Publish the run as it goes, so the stages and the trace show each finished step.
      const publish = () => setLastRun({ id: runId, steps: [...steps] })
      publish()
      try {
        const prepStarted = Date.now()
        let audio: EncodedAudio
        try {
          audio = await encodeForUpload(clip)
        } catch (err) {
          const detail = err instanceof NoSpeechError
            ? 'No speech energy in the recording, so nothing was sent'
            : 'The browser could not convert the recording'
          steps.push(step('prepare audio', 'failed', Date.now() - prepStarted, detail))
          failRun({ id: runId, steps: [...steps] }, messageOf(err, 'Could not prepare the recording.'))
          return
        }
        steps.push(
          step(
            'prepare audio',
            'ok',
            Date.now() - prepStarted,
            audio.format === 'wav' ? '16 kHz mono WAV' : `Sent the original ${audio.format} file`,
          ),
        )

        publish()

        let text = ''
        let serverMs = 0
        const sttStarted = Date.now()
        try {
          const result = await transcribe(audio, controller.signal)
          steps.push(...result.trace)
          publish()
          serverMs = result.totalMs ?? 0
          text = result.text
        } catch (err) {
          if (isAbort(err)) {
            steps.push(step('speech to text', 'skipped', Date.now() - sttStarted, 'Cancelled by you'))
            setLastRun({ id: runId, steps: [...steps] })
            setAppState('idle')
            return
          }
          const message = messageOf(err, 'Transcription failed. Try again.')
          if (err instanceof RunError) {
            steps.push(...err.trace)
            serverMs = err.totalMs ?? 0
          } else {
            steps.push(step('speech to text', 'failed', Date.now() - sttStarted, message))
          }
          const fallback = readBrowserText().trim()
          if (!fallback) {
            failRun({ id: runId, steps: [...steps], totalMs: serverMs }, message)
            return
          }
          steps.push(step('browser speech recognition', 'ok', 0, 'Used the browser transcript instead'))
          publish()
          setNotice('Deepgram was unavailable, so the browser transcript was used.')
          text = fallback
        }

        if (!text.trim() || isLikelySilence(text)) {
          steps.push(step('silence check', 'failed', 0, 'Only a filler phrase or nothing was heard, so no question was sent'))
          failRun({ id: runId, steps: [...steps], totalMs: serverMs }, SILENCE_MESSAGE)
          return
        }
        await askAndSpeak(text.trim(), runId, steps, serverMs, controller)
      } catch {
        failRun({ id: runId, steps: [...steps] }, UNEXPECTED)
      } finally {
        if (abortRef.current === controller) abortRef.current = null
      }
    },
    [askAndSpeak, failRun],
  )

  const recorder = useRecorder({
    onRecorded: handleRecorded,
    onNotice: setNotice,
    onFailure: message => failWithStep('record audio', message),
  })
  const { hasMic, msLeft, analyserRef, start, stop, markNoMic } = recorder

  const handleMicClick = useCallback(async () => {
    if (appState === 'recording') {
      stop()
      return
    }
    if (appState === 'speaking') {
      stopSpeaking()
      return
    }
    if (appState !== 'idle' || startingRef.current) return

    setError(null)
    setNotice(null)
    startingRef.current = true
    try {
      await start()
      setAppState('recording')
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      if (name === 'NotFoundError' || name === 'NotSupportedError') markNoMic()
      failWithStep('start recording', micErrorMessage(err))
    } finally {
      startingRef.current = false
    }
  }, [appState, failWithStep, markNoMic, start, stop, stopSpeaking])

  // Typed path: the same ask-and-speak steps, without the speech to text step.
  const sendText = useCallback(
    (text: string) => {
      setError(null)
      setNotice(null)
      runCounter += 1
      const runId = runCounter
      setLastRun({ id: runId, steps: [] })
      const controller = new AbortController()
      abortRef.current = controller
      void askAndSpeak(text, runId, [], 0, controller)
        .catch(() => failRun({ id: runId, steps: [] }, UNEXPECTED))
        .finally(() => {
          if (abortRef.current === controller) abortRef.current = null
        })
    },
    [askAndSpeak, failRun],
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  // Only offered while idle, so no run can publish into a cleared conversation.
  const clearConversation = useCallback(() => {
    commitMessages([])
    setLastRun(null)
    setError(null)
    setNotice(null)
  }, [commitMessages])

  // Unmount: stop any run in flight and any speech, so nothing speaks from a closed page.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      speakRef.current?.cancel()
      cancelSpeech()
    }
  }, [])

  return {
    appState,
    messages,
    error,
    notice,
    lastRun,
    hasMic,
    msLeft,
    analyserRef,
    handleMicClick,
    cancel,
    stopSpeaking,
    sendText,
    clearConversation,
    dismissError: () => setError(null),
    dismissNotice: () => setNotice(null),
  }
}
