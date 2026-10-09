import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import {
  RunError,
  transcribe,
  type ChatMessage,
  type EncodedAudio,
  type Message,
  type StepStatus,
  type TraceStep,
} from '../lib/api'
import { NoSpeechError, encodeForUpload, micErrorMessage } from '../lib/audio'
import { chat } from '../lib/chatStream'
import { UserFacingError } from '../lib/errors'
import { historyFor, markUnsent } from '../lib/history'
import { createReplyVoice, type ReplyVoice } from '../lib/replyVoice'
import { IDLE_RUN, runReducer, type RunState } from '../lib/run'
import { isLikelySilence } from '../lib/transcript'
import { useRecorder } from './useRecorder'

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

const now = () => performance.now()

// Owns the conversation and one run at a time: voice (record, transcribe, ask, speak) or typed (ask,
// speak). The answer streams in and is spoken sentence by sentence; one Stop ends the stream and the voice.
export function useAssistant() {
  const [run, dispatch] = useReducer(runReducer, IDLE_RUN)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const runRef = useRef<RunState>(IDLE_RUN)
  const messagesRef = useRef<ChatMessage[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const voiceRef = useRef<ReplyVoice | null>(null)
  const stoppedAtRef = useRef<number | null>(null)
  const startingRef = useRef(false)
  const pendingQuestionRef = useRef<string | null>(null)

  // The reducer's latest state, for handlers that run after an await.
  useEffect(() => {
    runRef.current = run
  }, [run])

  const commitMessages = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next
    setMessages(next)
  }, [])

  const begin = useCallback((via: 'voice' | 'text', question: string) => {
    runCounter += 1
    dispatch({ type: 'start', id: runCounter, via, question, now: now() })
    return runCounter
  }, [])

  const fail = useCallback((message: string, totalMs?: number) => {
    voiceRef.current?.cancel()
    dispatch({ type: 'fail', message, totalMs })
  }, [])

  // The model turn: send the question with recent history; the answer streams in and is spoken as it goes.
  const ask = useCallback(
    async (text: string, serverMs: number, controller: AbortController) => {
      const history = historyFor(messagesRef.current)
      const question = newMessage('user', text)
      pendingQuestionRef.current = question.id
      commitMessages([...messagesRef.current, question])
      const voice = createReplyVoice(dispatch)
      voiceRef.current = voice
      try {
        const done = await chat(
          text,
          history,
          {
            onStep: s => {
              dispatch({ type: 'step', step: s, now: now(), wall: Date.now() })
              // The model said its piece and went to call a tool: a sentence it ended is not waiting for more.
              if (s.name === 'model call' && s.detail.includes('asked for')) voice.segmentEnd()
            },
            onDelta: delta => voice.push(delta),
            onRetry: reason => dispatch({ type: 'step', step: step('connection', 'skipped', 0, `Retried once: ${reason}`), now: now() }),
          },
          controller.signal,
        )
        voice.finish()
        pendingQuestionRef.current = null
        commitMessages([...messagesRef.current, { ...newMessage('assistant', done.text), model: done.model }])
        dispatch({ type: 'stream-done', model: done.model, usage: done.usage, totalMs: serverMs + (done.totalMs ?? 0), now: now() })
      } catch (err) {
        // Stop has already ended the run and marked the question.
        if (isAbort(err)) return
        const message = messageOf(err, ASSISTANT_FAILED)
        commitMessages(markUnsent(messagesRef.current, question.id, message))
        pendingQuestionRef.current = null
        if (!(err instanceof RunError)) dispatch({ type: 'step', step: step('model call', 'failed', 0, message), now: now() })
        fail(message, err instanceof RunError && err.totalMs !== undefined ? serverMs + err.totalMs : undefined)
      }
    },
    [commitMessages, fail],
  )

  // Voice path: encode the clip, transcribe it (falling back to the browser's own recognition if the
  // server cannot), then ask the model.
  const handleRecorded = useCallback(
    async (clip: Blob, readBrowserText: () => string) => {
      const controller = new AbortController()
      abortRef.current = controller
      dispatch({ type: 'heard', now: stoppedAtRef.current ?? now() })
      stoppedAtRef.current = null
      const add = (s: TraceStep) => dispatch({ type: 'step', step: s, now: now() })
      try {
        const prepStarted = Date.now()
        let audio: EncodedAudio
        try {
          audio = await encodeForUpload(clip)
        } catch (err) {
          const detail = err instanceof NoSpeechError
            ? 'No speech energy in the recording, so nothing was sent'
            : 'The browser could not convert the recording'
          add(step('prepare audio', 'failed', Date.now() - prepStarted, detail))
          fail(messageOf(err, 'Could not prepare the recording.'))
          return
        }
        add(step('prepare audio', 'ok', Date.now() - prepStarted, audio.format === 'wav' ? '16 kHz mono WAV' : `Sent the original ${audio.format} file`))

        let text = ''
        let serverMs = 0
        const sttStarted = Date.now()
        try {
          const result = await transcribe(audio, controller.signal)
          result.trace.forEach(add)
          serverMs = result.totalMs ?? 0
          text = result.text
        } catch (err) {
          if (isAbort(err)) return
          const message = messageOf(err, 'Transcription failed. Try again.')
          if (err instanceof RunError) {
            err.trace.forEach(add)
            serverMs = err.totalMs ?? 0
          } else {
            add(step('speech to text', 'failed', Date.now() - sttStarted, message))
          }
          const fallback = readBrowserText().trim()
          if (!fallback) {
            fail(message, serverMs)
            return
          }
          add(step('browser speech recognition', 'ok', 0, 'Used the browser transcript instead'))
          setNotice('Deepgram was unavailable, so the browser transcript was used.')
          text = fallback
        }

        if (!text.trim() || isLikelySilence(text)) {
          add(step('silence check', 'failed', 0, 'Only a filler phrase or nothing was heard, so no question was sent'))
          fail(SILENCE_MESSAGE, serverMs)
          return
        }
        dispatch({ type: 'transcript', text: text.trim(), now: now() })
        await ask(text.trim(), serverMs, controller)
      } catch {
        fail(UNEXPECTED)
      } finally {
        if (abortRef.current === controller) abortRef.current = null
      }
    },
    [ask, fail],
  )

  const recorder = useRecorder({
    onRecorded: handleRecorded,
    onNotice: setNotice,
    onFailure: message => {
      begin('voice', '')
      dispatch({ type: 'step', step: step('record audio', 'failed', 0, message), now: now() })
      fail(message)
    },
  })
  const { hasMic, msLeft, analyserRef, start, stop, markNoMic } = recorder

  const recording = run.stage === 'recording'
  const busy = run.outcome === 'running'

  const startRecording = useCallback(async () => {
    if (busy || startingRef.current) return
    setNotice(null)
    startingRef.current = true
    try {
      await start()
      begin('voice', '')
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      if (name === 'NotFoundError' || name === 'NotSupportedError') markNoMic()
      begin('voice', '')
      dispatch({ type: 'step', step: step('start recording', 'failed', 0, micErrorMessage(err)), now: now() })
      fail(micErrorMessage(err))
    } finally {
      startingRef.current = false
    }
  }, [begin, busy, fail, markNoMic, start])

  const finishRecording = useCallback(() => {
    stoppedAtRef.current = now()
    stop()
  }, [stop])

  // Typed path: the same ask-and-speak steps, without the speech to text step.
  const sendText = useCallback(
    (text: string) => {
      setNotice(null)
      begin('text', text)
      const controller = new AbortController()
      abortRef.current = controller
      void ask(text, 0, controller)
        .catch(() => fail(UNEXPECTED))
        .finally(() => {
          if (abortRef.current === controller) abortRef.current = null
        })
    },
    [ask, begin, fail],
  )

  // One Stop: the stream, the model call behind it, the tools and the voice all end together.
  const stopRun = useCallback(() => {
    abortRef.current?.abort()
    voiceRef.current?.cancel()
    const unanswered = pendingQuestionRef.current
    if (unanswered && !runRef.current.streamDone) {
      commitMessages(markUnsent(messagesRef.current, unanswered, 'You stopped it.'))
      pendingQuestionRef.current = null
    }
    dispatch({ type: 'stop', now: now() })
  }, [commitMessages])

  // Only offered while idle, so no run can publish into a cleared conversation.
  const clearConversation = useCallback(() => {
    commitMessages([])
    dispatch({ type: 'clear' })
    setNotice(null)
  }, [commitMessages])

  // Unmount: stop any run in flight and any speech, so nothing speaks from a closed page.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      voiceRef.current?.cancel()
    }
  }, [])

  return {
    run,
    messages,
    notice,
    hasMic,
    msLeft,
    analyserRef,
    recording,
    busy,
    startRecording,
    finishRecording,
    stopRun,
    sendText,
    clearConversation,
    dismissNotice: () => setNotice(null),
  }
}
