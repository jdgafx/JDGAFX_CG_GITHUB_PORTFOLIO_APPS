import { ANSWER_MAX_CHARS, PROMPT_MAX_CHARS, SLOTS, SYSTEM_MAX_CHARS, type Slot } from './contract'
import { isRecord } from './parse'

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

export interface CompareInput {
  prompt: string
  models: [string, string, string]
  system?: string
  temperature?: number
}

export function parseCompare(body: unknown): Parsed<CompareInput> {
  if (!isRecord(body)) return fail('Request body must be a JSON object')
  const { prompt, models, system, temperature } = body
  if (!isPrompt(prompt)) return fail(`Prompt must be 1 to ${PROMPT_MAX_CHARS} characters`)
  if (!Array.isArray(models) || models.length !== 3 || !models.every(m => typeof m === 'string')) {
    return fail('models must list three model IDs')
  }
  const hasSystem = typeof system === 'string' && system !== ''
  if (system !== undefined && system !== '' && (typeof system !== 'string' || system.length > SYSTEM_MAX_CHARS)) {
    return fail(`System prompt must be ${SYSTEM_MAX_CHARS} characters or fewer`)
  }
  if (temperature !== undefined && !isTemperature(temperature)) return fail('Temperature must be between 0 and 1')
  return {
    ok: true,
    value: {
      prompt,
      models: [models[0], models[1], models[2]] as [string, string, string],
      system: hasSystem ? system : undefined,
      temperature: typeof temperature === 'number' ? temperature : undefined,
    },
  }
}

export interface JudgeInput {
  prompt: string
  answers: { slot: Slot; text: string }[]
}

export function parseJudge(body: unknown): Parsed<JudgeInput> {
  if (!isRecord(body)) return fail('Request body must be a JSON object')
  const { prompt, answers } = body
  if (!isPrompt(prompt)) return fail(`Prompt must be 1 to ${PROMPT_MAX_CHARS} characters`)
  if (!Array.isArray(answers) || answers.length < 1 || answers.length > SLOTS.length) {
    return fail(`Send between 1 and ${SLOTS.length} answers`)
  }
  const seen = new Set<string>()
  const list: { slot: Slot; text: string }[] = []
  for (const raw of answers) {
    if (!isRecord(raw) || !isSlot(raw.slot) || seen.has(raw.slot) || typeof raw.text !== 'string' || raw.text.trim() === '') {
      return fail('Each answer needs a unique slot (A, B or C) and text')
    }
    seen.add(raw.slot)
    list.push({ slot: raw.slot, text: capAnswer(raw.text) })
  }
  return { ok: true, value: { prompt, answers: list } }
}

function isPrompt(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= PROMPT_MAX_CHARS
}

function isTemperature(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function isSlot(value: unknown): value is Slot {
  return typeof value === 'string' && (SLOTS as readonly string[]).includes(value)
}

// Keeps a very long answer from blowing up the judge request. The judge is told it was cut.
function capAnswer(text: string): string {
  return text.length > ANSWER_MAX_CHARS ? `${text.slice(0, ANSWER_MAX_CHARS)}\n[answer cut short for judging]` : text
}
