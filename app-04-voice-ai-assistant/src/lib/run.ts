// The state of the run on screen: one question, from the end of speech (or Ask) to the end of the voice.
// A pure reducer, so the streaming order of events is tested without a browser. The hook feeds it.
import type { TraceStep, Usage } from './api'
import type { Marks } from './ttfa'

export type Outcome = 'idle' | 'running' | 'done' | 'failed' | 'stopped'
export type Stage = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'answering' | 'speaking'
// pending: no sentence has started yet. none: this device has no voice. failed: the voice broke.
export type Voice = 'pending' | 'speaking' | 'done' | 'none' | 'failed'

export interface RunState {
  id: number
  outcome: Outcome
  stage: Stage
  via: 'voice' | 'text'
  question: string
  steps: TraceStep[]
  /** Complete sentences of the answer, in order. */
  sentences: string[]
  /** The unfinished tail of the answer. */
  rest: string
  /** The sentence being spoken, or -1. */
  active: number
  /** How many sentences the voice has finished. */
  spoken: number
  voice: Voice
  voiceNote?: string
  /** The server finished the answer. */
  streamDone: boolean
  model?: string
  usage?: Usage
  totalMs?: number
  error?: string
  marks: Marks
  /** Wall-clock time each trace step arrived, by step index, for the live-data chip. */
  arrivedAt: Record<number, number>
}

export const IDLE_RUN: RunState = {
  id: 0,
  outcome: 'idle',
  stage: 'idle',
  via: 'text',
  question: '',
  steps: [],
  sentences: [],
  rest: '',
  active: -1,
  spoken: 0,
  voice: 'pending',
  streamDone: false,
  marks: { origin: 0 },
  arrivedAt: {},
}

export type RunAction =
  | { type: 'start'; id: number; via: 'voice' | 'text'; question: string; now: number }
  | { type: 'heard'; now: number }
  | { type: 'step'; step: TraceStep; now: number; wall?: number }
  | { type: 'transcript'; text: string; now: number }
  | { type: 'text'; sentences: string[]; rest: string; now: number }
  | { type: 'speech-start'; index: number; now: number }
  | { type: 'speech-end'; index: number }
  | { type: 'voice-idle'; now: number }
  | { type: 'no-voice'; now: number }
  | { type: 'voice-failed'; message: string; now: number }
  | { type: 'stream-done'; model?: string; usage?: Usage; totalMs?: number; now: number }
  | { type: 'fail'; message: string; totalMs?: number }
  | { type: 'stop'; now: number }
  | { type: 'clear' }

const NO_VOICE_NOTE = 'This browser has no voice installed, so the reply is text only.'

/** The whole answer as text: finished sentences, then the tail. */
export function answerText(run: Pick<RunState, 'sentences' | 'rest'>): string {
  return [...run.sentences, run.rest.trim()].filter(Boolean).join(' ')
}

// The last row of the trace: what the voice did.
function speakStep(run: RunState, now: number, stopped: boolean): TraceStep {
  const name = 'speak reply'
  const sentences = run.sentences.length === 1 ? '1 sentence' : `${run.sentences.length} sentences`
  const spent = run.marks.speechStartAt === undefined ? 0 : Math.round(now - run.marks.speechStartAt)
  if (stopped) return { name, status: 'skipped', ms: spent, detail: 'Stopped by you' }
  if (run.voice === 'none') return { name, status: 'skipped', ms: 0, detail: 'No voice is installed in this browser, so the reply is shown as text' }
  if (run.voice === 'failed') return { name, status: 'failed', ms: spent, detail: run.voiceNote ?? 'Voice playback failed' }
  if (run.sentences.length === 0) return { name, status: 'skipped', ms: 0, detail: 'There was nothing to read aloud' }
  return { name, status: 'ok', ms: spent, detail: `Read aloud by the browser, ${sentences}` }
}

// Once the server has finished, the run is over when the voice is: sentences still waiting for it keep it
// in the speaking stage. A run with no sentence, or no voice, ends the moment the server does.
function settle(run: RunState, now: number): RunState {
  if (!run.streamDone || run.outcome !== 'running') return run
  const voiceBusy = (run.voice === 'pending' || run.voice === 'speaking') && run.sentences.length > 0
  if (voiceBusy) return { ...run, stage: 'speaking' }
  return { ...run, outcome: 'done', stage: 'idle', steps: [...run.steps, speakStep(run, now, false)] }
}

export function runReducer(run: RunState, action: RunAction): RunState {
  switch (action.type) {
    case 'start':
      return {
        ...IDLE_RUN,
        id: action.id,
        outcome: 'running',
        stage: action.via === 'voice' ? 'recording' : 'thinking',
        via: action.via,
        question: action.question,
        marks: { origin: action.now },
      }
    // The visitor stopped talking: the clock for time to first audio starts here.
    case 'heard':
      return run.outcome === 'running' ? { ...run, stage: 'transcribing', marks: { ...run.marks, origin: action.now } } : run
    case 'step': {
      const marks = { ...run.marks }
      const { name, detail } = action.step
      if (name === 'model call' && detail.includes('asked for')) marks.toolsStartAt = action.now
      if (name === 'tool call') marks.toolsEndAt = action.now
      return { ...run, steps: [...run.steps, action.step], marks, arrivedAt: action.wall === undefined ? run.arrivedAt : { ...run.arrivedAt, [run.steps.length]: action.wall } }
    }
    case 'transcript':
      return {
        ...run,
        question: action.text,
        stage: 'thinking',
        marks: { ...run.marks, transcriptAt: action.now },
      }
    case 'text': {
      const marks = { ...run.marks }
      if (action.sentences.length > 0 || action.rest.trim()) marks.firstTokenAt ??= action.now
      if (action.sentences.length > 0) marks.firstSentenceAt ??= action.now
      return {
        ...run,
        stage: run.stage === 'speaking' ? 'speaking' : 'answering',
        sentences: [...run.sentences, ...action.sentences],
        rest: action.rest,
        marks,
      }
    }
    case 'speech-start': {
      if (run.outcome !== 'running') return run
      const marks = { ...run.marks }
      marks.speechStartAt ??= action.now
      return { ...run, active: action.index, voice: 'speaking', marks }
    }
    case 'speech-end':
      return { ...run, active: run.active === action.index ? -1 : run.active, spoken: Math.max(run.spoken, action.index + 1) }
    case 'voice-idle':
      return settle({ ...run, voice: 'done', active: -1 }, action.now)
    case 'no-voice':
      return settle({ ...run, voice: 'none', voiceNote: NO_VOICE_NOTE, active: -1 }, action.now)
    case 'voice-failed':
      return settle({ ...run, voice: 'failed', voiceNote: action.message, active: -1 }, action.now)
    case 'stream-done':
      return settle({ ...run, streamDone: true, model: action.model, usage: action.usage, totalMs: action.totalMs }, action.now)
    case 'fail':
      return { ...run, outcome: 'failed', stage: 'idle', error: action.message, totalMs: action.totalMs ?? run.totalMs, active: -1 }
    case 'clear':
      return IDLE_RUN
    case 'stop': {
      if (run.outcome !== 'running') return run
      const heard = run.voice === 'speaking' || run.sentences.length > 0
      const steps = heard ? [...run.steps, speakStep(run, action.now, true)] : run.steps
      // An answer the server finished is a finished answer; Stop only silenced the voice.
      return { ...run, outcome: run.streamDone ? 'done' : 'stopped', stage: 'idle', active: -1, steps }
    }
  }
}
