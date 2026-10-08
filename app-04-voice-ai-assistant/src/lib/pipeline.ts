import type { TraceStep } from './api'

// The phase of the page's run. It mirrors the assistant's state without importing it,
// so this module stays pure and type-checks in the test project.
export type RunPhase = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking'

export type StageState = 'waiting' | 'running' | 'ok' | 'failed' | 'skipped' | 'notrun'

export interface StageView {
  state: StageState
  ms?: number
  // A short reason shown in place of the stage's description, for a stage that was not used.
  note?: string
}

export interface PipelineView {
  listen: StageView
  think: StageView
  speak: StageView
  transcriptPassed: boolean
  replyPassed: boolean
}

// The step running now. It is derived from the phase, never stored on the run record,
// so a failed or stopped run needs no cleanup.
export interface LiveStep {
  name: string
  detail: string
}

const WAITING: StageView = { state: 'waiting' }
const NOT_RUN: StageView = { state: 'notrun' }
const TYPED_NOTE = 'Not used for a typed question'

// Steps that only a voice question produces. A typed question has none of them.
const VOICE_STEPS = new Set([
  'record audio',
  'start recording',
  'prepare audio',
  'audio received',
  'speech to text',
  'browser speech recognition',
  'silence check',
])

// Where the model part of a run begins. A typed question has no voice steps, so all of its
// steps belong to the model. For a voice question the model part starts at its first model
// step, or at a server error that follows a finished transcript, which is the chat failing.
function thinkStart(steps: TraceStep[]): number {
  if (!steps.some(step => VOICE_STEPS.has(step.name))) return 0
  let transcriptDone = false
  for (let i = 0; i < steps.length; i++) {
    const { name, status } = steps[i]
    if (name === 'request built' || name === 'model call') return i
    if (name === 'server error' && transcriptDone) return i
    if ((name === 'parse and validate' || name === 'browser speech recognition') && status === 'ok') {
      transcriptDone = true
    }
  }
  return steps.length
}

// The model part runs from its first step up to the speak step.
function thoughtSteps(steps: TraceStep[]): TraceStep[] {
  const end = steps.findIndex(step => step.name === 'speak reply')
  return steps.slice(thinkStart(steps), end === -1 ? steps.length : end)
}

function listenView(phase: RunPhase, steps: TraceStep[] | null): StageView {
  if (phase === 'recording' || phase === 'transcribing') return { state: 'running' }
  if (steps === null) return WAITING
  const heard = steps.slice(0, thinkStart(steps))
  // A typed question has no voice steps at all.
  if (heard.length === 0) return { state: 'skipped', note: TYPED_NOTE }
  // A failure before the browser transcript is forgiven: the browser stood in for the server.
  const fallbackAt = heard.findIndex(step => step.name === 'browser speech recognition' && step.status === 'ok')
  const failure = heard.find((step, i) => step.status === 'failed' && (fallbackAt === -1 || i > fallbackAt))
  if (failure) return { state: 'failed', ms: failure.ms }
  const transcribed = heard.find(step => step.name === 'speech to text')
  if (fallbackAt !== -1) return { state: 'ok', ms: transcribed?.ms }
  if (transcribed) return { state: transcribed.status, ms: transcribed.ms }
  return NOT_RUN
}

function thinkView(phase: RunPhase, steps: TraceStep[] | null): StageView {
  if (phase === 'thinking') return { state: 'running' }
  if (phase === 'recording' || phase === 'transcribing' || steps === null) return WAITING
  const thought = thoughtSteps(steps)
  if (thought.length === 0) return NOT_RUN
  // Any failure in the model part fails the stage, including an empty or refused reply.
  const failure = thought.find(step => step.status === 'failed')
  if (failure) return { state: 'failed', ms: failure.ms }
  const call = thought.find(step => step.name === 'model call')
  if (call) return { state: call.status, ms: call.ms }
  return NOT_RUN
}

function speakView(phase: RunPhase, steps: TraceStep[] | null): StageView {
  if (phase === 'speaking') return { state: 'running' }
  if (phase !== 'idle' || steps === null) return WAITING
  const speak = steps.find(step => step.name === 'speak reply')
  return speak ? { state: speak.status, ms: speak.ms } : NOT_RUN
}

// The three stages of the last question, and which edges the question passed along.
export function pipelineView(phase: RunPhase, steps: TraceStep[] | null): PipelineView {
  const listen = listenView(phase, steps)
  const think = thinkView(phase, steps)
  return {
    listen,
    think,
    speak: speakView(phase, steps),
    transcriptPassed: listen.state === 'ok',
    replyPassed: think.state === 'ok',
  }
}

// The step that is running now, shown as the next trace row.
export function liveStep(phase: RunPhase, steps: TraceStep[] | null): LiveStep | null {
  switch (phase) {
    case 'recording':
      return { name: 'record audio', detail: 'Recording from the microphone' }
    case 'transcribing': {
      const prepared = steps?.some(step => step.name === 'prepare audio') ?? false
      return prepared
        ? { name: 'speech to text', detail: 'Deepgram is transcribing the clip on the server' }
        : { name: 'prepare audio', detail: 'Converting the recording to 16 kHz mono WAV in this browser' }
    }
    case 'thinking':
      return { name: 'model call', detail: 'Waiting for the chat model to reply' }
    case 'speaking':
      return { name: 'speak reply', detail: 'Reading the reply aloud in this browser' }
    default:
      return null
  }
}
