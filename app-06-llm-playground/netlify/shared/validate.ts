import {
  ANSWER_MAX_CHARS,
  JUDGE_TOTAL_MAX_CHARS,
  MODEL_ID_MAX_CHARS,
  PROMPT_MAX_CHARS,
  SLOTS,
  SYSTEM_MAX_CHARS,
  type CompareRequest,
  RUN_ID_PATTERN,
  VOTE_CHOICES,
  type JudgeRequest,
  type Slot,
  type VoteChoice,
  type VoteRequest,
} from './contract'
import { isRecord } from './parse'

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

export function parseCompare(body: unknown): Parsed<CompareRequest> {
  if (!isRecord(body)) return fail('Request body must be a JSON object')
  const { prompt, models, system, temperature, blind } = body
  if (!isPrompt(prompt)) return fail(`Prompt must be 1 to ${PROMPT_MAX_CHARS} characters`)
  if (!Array.isArray(models) || models.length !== 3 || !models.every(isModelId)) {
    return fail('models must list three model IDs')
  }
  const hasSystem = typeof system === 'string' && system !== ''
  if (system !== undefined && system !== '' && (typeof system !== 'string' || system.length > SYSTEM_MAX_CHARS)) {
    return fail(`System prompt must be ${SYSTEM_MAX_CHARS} characters or fewer`)
  }
  if (temperature !== undefined && !isTemperature(temperature)) return fail('Temperature must be between 0 and 1')
  if (blind !== undefined && typeof blind !== 'boolean') return fail('blind must be true or false')
  return {
    ok: true,
    value: {
      prompt,
      models: [models[0], models[1], models[2]] as [string, string, string],
      system: hasSystem ? system : undefined,
      temperature: typeof temperature === 'number' ? temperature : undefined,
      blind: blind === true ? true : undefined,
    },
  }
}

export function parseVote(body: unknown): Parsed<VoteRequest> {
  if (!isRecord(body)) return fail('Request body must be a JSON object')
  const { runId, choice } = body
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) return fail('runId is not a run this server issued')
  if (typeof choice !== 'string' || !VOTE_CHOICES.includes(choice as VoteChoice)) {
    return fail('choice must be A, B, C, tie or all-bad')
  }
  return { ok: true, value: { runId, choice: choice as VoteChoice } }
}

export function parseJudge(body: unknown): Parsed<JudgeRequest> {
  if (!isRecord(body)) return fail('Request body must be a JSON object')
  const { prompt, answers } = body
  if (!isPrompt(prompt)) return fail(`Prompt must be 1 to ${PROMPT_MAX_CHARS} characters`)
  if (!Array.isArray(answers) || answers.length < 1 || answers.length > SLOTS.length) {
    return fail(`Send between 1 and ${SLOTS.length} answers`)
  }
  const seen = new Set<string>()
  const list: JudgeRequest['answers'] = []
  let total = 0
  for (const raw of answers) {
    if (!isRecord(raw) || !isSlot(raw.slot) || seen.has(raw.slot) || typeof raw.text !== 'string' || raw.text.trim() === '') {
      return fail('Each answer needs a unique slot (A, B or C) and text')
    }
    if (raw.text.length > ANSWER_MAX_CHARS) return fail(`Each answer must be ${ANSWER_MAX_CHARS} characters or fewer`)
    seen.add(raw.slot)
    total += raw.text.length
    list.push({ slot: raw.slot, text: raw.text })
  }
  if (total > JUDGE_TOTAL_MAX_CHARS) {
    return fail(`The answers together must be ${JUDGE_TOTAL_MAX_CHARS} characters or fewer`)
  }
  return { ok: true, value: { prompt, answers: list } }
}

function isPrompt(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= PROMPT_MAX_CHARS
}

function isModelId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MODEL_ID_MAX_CHARS
}

function isTemperature(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function isSlot(value: unknown): value is Slot {
  return typeof value === 'string' && (SLOTS as readonly string[]).includes(value)
}

