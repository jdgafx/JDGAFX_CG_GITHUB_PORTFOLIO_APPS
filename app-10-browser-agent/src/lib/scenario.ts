import type { BotStep, FieldKey, FieldValues, ResultRow, SpeedMode, StepAction } from '../types'
import {
  BASE_TYPING_MS,
  CURSOR_ANCHORS,
  MAX_RESULT_ROWS,
  MIN_TYPING_MS,
  SPEED_DELAYS,
  TYPING_BUDGET,
} from './constants'

const FIELD_PATTERNS: Array<[FieldKey, RegExp]> = [
  ['date', /\bdate\b|\bwhen\b|calendar/i],
  ['destination', /destination|arriv|drop-?off|\bdest\b|\bto\b/i],
  ['origin', /origin|depart|pick-?up|\bfrom\b/i],
  ['email', /e-?mail/i],
  ['phone', /phone|mobile|\btel\b/i],
  ['name', /name/i],
  ['experience', /experience|resume|cover letter|message|about/i],
]

/** Which mock input a step is aimed at, read from the step's own target text. */
export function fieldKeyForTarget(target: string): FieldKey {
  for (const [key, pattern] of FIELD_PATTERNS) {
    if (pattern.test(target)) return key
  }
  return 'search'
}

/**
 * Text to render in each mock input at the current point of the run: fully committed for
 * steps already played, character-by-character for the step being typed right now.
 */
export function fieldValuesAt(steps: BotStep[], currentStepIndex: number, typedText: string): FieldValues {
  const values: FieldValues = {}
  steps.slice(0, currentStepIndex + 1).forEach((step, i) => {
    if (step.action !== 'type' || !step.value) return
    values[fieldKeyForTarget(step.target)] = i === currentStepIndex ? typedText : step.value
  })
  return values
}

const LEADING_MARKER = /^\s*(?:[-*•]|\d+[.)])\s*/
const DETAIL_SPLIT = /\s+[—–]\s+|\s+-\s+(?!\$?\s?\d)|\s*\|\s*/
const AMOUNT = String.raw`\d+(?:,\d{3})*(?:\.\d+)?\s*[kKmM]?`
// Unit rides each amount ("$85/hr - $120/hr"), not just the whole range; "to" is a valid separator.
// Any short word can be a unit (night, person, seat, ...) — a whitelist just fails on the next one.
const UNIT = String.raw`(?:\s*\/\s*[A-Za-z][A-Za-z.]{0,8})?`
const MONEY = String.raw`\$\s?${AMOUNT}${UNIT}`
const VALUE_TOKEN = new RegExp(`${MONEY}(?:\\s*(?:[-–—]|\\bto\\b)\\s*${MONEY})?|\\b\\d+(?:\\.\\d+)?%`, 'i')

/**
 * Turn an extract/verify step's value into rows the mock page can render, so the simulated
 * page shows the same data the results panel reports instead of contradicting it.
 */
export function parseResultRows(value: string): ResultRow[] {
  return value
    .split('\n')
    .map((line) => line.replace(LEADING_MARKER, '').trim())
    .filter(Boolean)
    .slice(0, MAX_RESULT_ROWS)
    .map((line) => {
      const [head, ...rest] = line.split(DETAIL_SPLIT)
      const tail = rest.join(' · ').trim()
      // Only lift a headline value when the line actually split — scraping prose
      // pulls mid-sentence amounts (a cancellation fee) up as the row's "price".
      const match = tail ? tail.match(VALUE_TOKEN) : undefined
      const detail = tail
        .replace(VALUE_TOKEN, '')
        .replace(/\s*[,·]\s*(?=[,·]|$)/g, '')
        .replace(/,(?=\s*\/)/g, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/,(?=\s*\()/g, '')
        .replace(/,\s*$/, '')
        .replace(/^[\s,·-]+|[\s,·]+$/g, '')
      return {
        title: head.trim() || line,
        detail: detail || undefined,
        value: match?.[0].trim(),
      }
    })
}

function lastStepValue(steps: BotStep[], action: StepAction): string | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]
    if (step.action === action && step.value) return step.value
  }
  return undefined
}

/** The scenario's own extracted data — what the simulated page is meant to be showing. */
export function scenarioResultRows(steps: BotStep[]): ResultRow[] {
  // The mock page renders the run's final state, so the LAST extract is the one it must
  // agree with — early extracts belong to pages the agent already navigated away from.
  const extracted = lastStepValue(steps, 'extract')
  const verified = lastStepValue(steps, 'verify')
  const rows = parseResultRows(extracted ?? verified ?? '')
  // A single row is a legitimate outcome (e.g. a booking confirmation) — never
  // discard it, or the mock page ends a successful run on a loading skeleton.
  return rows
}

/** Per-character delay that keeps a typing animation inside the current step's time budget. */
export function typingIntervalMs(speed: SpeedMode, length: number): number {
  const budget = (SPEED_DELAYS[speed] * TYPING_BUDGET) / Math.max(length, 1)
  return Math.max(MIN_TYPING_MS, Math.min(BASE_TYPING_MS[speed], Math.floor(budget)))
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max)

/**
 * Cursor target for a step. Offsets are derived from the step index so that consecutive
 * steps of the same action type still move the cursor.
 */
export function cursorPositionFor(action: StepAction, index: number): { x: number; y: number } {
  const anchor = CURSOR_ANCHORS[action]
  return {
    x: clamp(anchor.x + (((index * 37) % 19) - 9), 6, 90),
    y: clamp(anchor.y + (((index * 53) % 15) - 7), 8, 88),
  }
}
