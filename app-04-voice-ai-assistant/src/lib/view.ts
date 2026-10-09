// Words and numbers the screen shows, derived from the run state. Pure, so each is tested.
import type { Reading, TraceStep } from './api'
import { answerText, type RunState, type Stage } from './run'

export type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'muted'

export interface Badge {
  label: string
  tone: Tone
  dot: string
}

const STAGE_WORD: Record<Exclude<Stage, 'idle'>, string> = {
  recording: 'Recording',
  transcribing: 'Transcribing',
  thinking: 'Thinking',
  answering: 'Answering',
  speaking: 'Speaking',
}

/** The masthead badge. Success only for a finished answer; the word always carries the state too. */
export function badgeFor(run: RunState, hasMic: boolean): Badge {
  if (run.outcome === 'running' && run.stage !== 'idle') return { label: STAGE_WORD[run.stage], tone: 'accent', dot: 'ds-dot ds-dot--running' }
  if (run.outcome === 'done') return { label: 'Answered', tone: 'success', dot: 'ds-dot ds-dot--ok' }
  if (run.outcome === 'failed') return { label: 'Failed', tone: 'danger', dot: 'ds-dot ds-dot--failed' }
  if (run.outcome === 'stopped') return { label: 'Stopped', tone: 'warning', dot: 'ds-dot ds-dot--stopped' }
  return hasMic ? { label: 'Ready', tone: 'muted', dot: 'ds-dot' } : { label: 'Text only', tone: 'muted', dot: 'ds-dot' }
}

/** The one-line status under the buttons. It changes only when the stage does, so a screen reader is not flooded. */
export function statusLine(run: RunState, hasMic: boolean): string {
  switch (run.outcome) {
    case 'running':
      switch (run.stage) {
        case 'recording':
          return 'Recording. Press Stop recording when you finish speaking.'
        case 'transcribing':
          return 'Transcribing what you said on the server.'
        case 'thinking':
          return 'Thinking. The first words appear as soon as the model writes them.'
        case 'answering':
          return run.voice === 'none' ? 'Answering. This browser has no voice, so the reply is text only.' : 'Answering. Each sentence is read aloud as soon as it is complete.'
        default:
          return 'Reading the reply aloud. Press Stop to end it.'
      }
    case 'done':
      return 'Answered. Ask another question or press an example.'
    case 'failed':
      return 'Failed. The answer panel says why.'
    case 'stopped':
      return 'Stopped. The stream and the voice were ended. What had arrived is kept.'
    default:
      return hasMic ? 'Ready. Press Record, or type a question and press Ask.' : 'No microphone found. Type your question and press Ask.'
  }
}

/** The sentences as the screen draws them, each with whether it is the one being spoken or already spoken. */
export interface DrawnSentence {
  text: string
  state: 'spoken' | 'active' | 'waiting'
}

export function drawSentences(run: Pick<RunState, 'sentences' | 'active' | 'spoken' | 'voice'>): DrawnSentence[] {
  return run.sentences.map((text, i) => ({
    text,
    state: i === run.active ? 'active' : i < run.spoken && run.voice !== 'none' ? 'spoken' : 'waiting',
  }))
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "07:15" from Open-Meteo's local time "2026-10-09T07:15". */
function clockOf(local: string): string {
  const match = /T(\d{2}:\d{2})/.exec(local)
  return match ? match[1] : local
}

function utcClock(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
}

/** One line saying which Open-Meteo reading a weather answer used, and when it was fetched. */
export function readingNote(step: Pick<TraceStep, 'detail' | 'reading'>): string | null {
  const reading: Reading | undefined = step.reading
  if (!reading) return null
  const place = step.detail.split(': ')[0]
  const zone = reading.abbreviation ? ` (${reading.abbreviation})` : ''
  const every = reading.intervalSeconds ? `, refreshed every ${Math.round(reading.intervalSeconds / 60)} minutes` : ''
  return `${place}: Open-Meteo reading for ${clockOf(reading.time)} local time${zone}${every}. Fetched at ${utcClock(reading.fetchedAt)}.`
}

/** The waterfall: where each step's bar starts and how wide it is, as percentages of the run. */
export interface Lane {
  left: number
  width: number
}

export function lanes(steps: Pick<TraceStep, 'ms' | 'call'>[]): Lane[] {
  const total = Math.max(1, sumTime(steps))
  const out: Lane[] = []
  let cursor = 0
  let toolStart: number | null = null
  let toolLongest = 0
  steps.forEach((step, i) => {
    const tool = step.call !== undefined
    // Tool calls of one round ran at the same time: they share a start, and the round ends with the slowest.
    if (tool) {
      toolStart ??= cursor
      toolLongest = Math.max(toolLongest, step.ms)
      out.push({ left: (toolStart / total) * 100, width: Math.max(1, (step.ms / total) * 100) })
      if (!steps[i + 1] || steps[i + 1].call === undefined) {
        cursor = toolStart + toolLongest
        toolStart = null
        toolLongest = 0
      }
      return
    }
    out.push({ left: (cursor / total) * 100, width: Math.max(1, (step.ms / total) * 100) })
    cursor += step.ms
  })
  return out
}

/** Run time as the lanes count it: steps in order, a round of parallel tool calls counting once. */
function sumTime(steps: Pick<TraceStep, 'ms' | 'call'>[]): number {
  let total = 0
  let longest = 0
  steps.forEach((step, i) => {
    if (step.call !== undefined) {
      longest = Math.max(longest, step.ms)
      if (!steps[i + 1] || steps[i + 1].call === undefined) {
        total += longest
        longest = 0
      }
    } else total += step.ms
  })
  return total
}

export { answerText }
