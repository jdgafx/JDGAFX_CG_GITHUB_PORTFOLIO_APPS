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
  ['destination', /destination|arriv|drop-?off|\bdest\b|\bto\b/i],
  ['origin', /origin|depart|pick-?up|\bfrom\b/i],
  ['date', /\bdate\b|\bwhen\b|calendar/i],
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
const DETAIL_SPLIT = /\s+[—–-]\s+|\s*\|\s*/
const AMOUNT = String.raw`\d+(?:,\d{3})*(?:\.\d+)?\s*[kKmM]?`
const VALUE_TOKEN = new RegExp(`\\$\\s?${AMOUNT}(?:\\s*[-–—]\\s*\\$?\\s?${AMOUNT})?|\\b\\d+(?:\\.\\d+)?%`)

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
      const match = (tail || line).match(VALUE_TOKEN)
      const detail = tail
        .replace(VALUE_TOKEN, '')
        .replace(/\s*[,·]\s*(?=[,·]|$)/g, '')
        .replace(/^[\s,·]+|[\s,·]+$/g, '')
      return {
        title: head.trim() || line,
        detail: detail || undefined,
        value: match?.[0].trim(),
      }
    })
}

/** The scenario's own extracted data — what the simulated page is meant to be showing. */
export function scenarioResultRows(steps: BotStep[]): ResultRow[] {
  const extracted = steps.find((s) => s.action === 'extract' && s.value)?.value
  const verified = steps.find((s) => s.action === 'verify' && s.value)?.value
  const rows = parseResultRows(extracted ?? verified ?? '')
  return rows.length >= 2 ? rows : []
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
