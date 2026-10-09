import {
  MAX_BODY_BYTES,
  MAX_CELL_CHARS,
  MAX_HEADERS,
  MAX_QUESTION_CHARS,
  MAX_ROWS,
  MAX_SAMPLE_ROWS,
} from '../../src/lib/limits'
import { isRecord, validateQueryPlan } from '../../src/lib/queryPlan'
import type { QueryPlan } from '../../src/types'

/** The browser's request after validation: every sample cell is text and every key is a column. */
export interface AnalysisInput {
  question: string
  headers: string[]
  sampleRows: Record<string, string>[]
  rowCount: number
  /** Set on a follow-up: the question and the checked plan it refines. */
  previous?: { question: string; plan: QueryPlan }
}

/** The previous plan's free text is cut before it enters a prompt. The plan itself is rebuilt by the plan check. */
const MAX_PLAN_TEXT_CHARS = 200

interface Rejection {
  ok: false
  status: number
  error: string
}

type Checked<T> = { ok: true; value: T } | Rejection

const TOO_LARGE: Rejection = { ok: false, status: 413, error: 'Request is too large.' }
const NOT_JSON = 'Request body was not valid JSON.'

function reject(status: number, error: string): Rejection {
  return { ok: false, status, error }
}

/** Reads the body as bytes, so the size limit counts what was sent rather than characters. */
export async function readJsonBody(req: Request): Promise<Checked<unknown>> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return TOO_LARGE

  let bytes: ArrayBuffer
  try {
    bytes = await req.arrayBuffer()
  } catch {
    return reject(400, NOT_JSON)
  }
  if (bytes.byteLength > MAX_BODY_BYTES) return TOO_LARGE

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) }
  } catch {
    return reject(400, NOT_JSON)
  }
}

/** Checks every field of the request. Returns the typed input, or the 400 to send back. */
export function checkAnalysisBody(body: unknown): Checked<AnalysisInput> {
  if (!isRecord(body)) return reject(400, 'Request body must be a JSON object.')
  const { question, headers, sampleRows, rowCount, previous } = body

  if (typeof question !== 'string' || question.trim() === '') return reject(400, 'A question is required.')
  const asked = question.trim()
  if (asked.length > MAX_QUESTION_CHARS) {
    return reject(400, `Question is too long (max ${MAX_QUESTION_CHARS} characters).`)
  }

  if (!Array.isArray(headers) || headers.length === 0) return reject(400, 'Dataset columns are required.')
  const names: unknown[] = headers
  if (names.length > MAX_HEADERS) return reject(400, `Dataset has too many columns (max ${MAX_HEADERS}).`)
  if (!names.every((name) => typeof name === 'string')) return reject(400, 'Column names must be text.')
  if (names.some((name) => name.length > MAX_CELL_CHARS)) {
    return reject(400, `A column name is longer than ${MAX_CELL_CHARS} characters.`)
  }

  if (!Array.isArray(sampleRows)) return reject(400, 'Sample rows must be a list.')
  if (sampleRows.length > MAX_SAMPLE_ROWS) return reject(400, `Too many sample rows (max ${MAX_SAMPLE_ROWS}).`)
  const rows: Record<string, string>[] = []
  for (const raw of sampleRows as unknown[]) {
    if (!isRecord(raw)) return reject(400, 'A sample row is not valid.')
    const row: Record<string, string> = {}
    for (const column of names) {
      const cell = raw[column]
      if (cell === undefined) continue
      if (typeof cell !== 'string' && typeof cell !== 'number') return reject(400, 'Sample cells must be text.')
      const text = String(cell)
      if (text.length > MAX_CELL_CHARS) {
        return reject(400, `A sample cell is longer than ${MAX_CELL_CHARS} characters.`)
      }
      row[column] = text
    }
    rows.push(row)
  }

  if (typeof rowCount !== 'number' || !Number.isInteger(rowCount) || rowCount < 0 || rowCount > MAX_ROWS) {
    return reject(400, 'The row count is not valid.')
  }

  const input: AnalysisInput = { question: asked, headers: names, sampleRows: rows, rowCount }
  if (previous !== undefined && previous !== null) {
    const earlier = checkPrevious(previous, names)
    if (!earlier.ok) return earlier
    input.previous = earlier.value
  }
  return { ok: true, value: input }
}

/** The plan a follow-up refines. It must pass the same plan check as a model reply, against the same columns. */
function checkPrevious(previous: unknown, headers: string[]): Checked<NonNullable<AnalysisInput['previous']>> {
  const invalid = reject(400, 'The previous plan is not valid.')
  if (!isRecord(previous) || typeof previous.question !== 'string') return invalid
  const question = previous.question.trim()
  if (question === '' || question.length > MAX_QUESTION_CHARS) return invalid
  const plan = validateQueryPlan(previous.plan, headers)
  if (!plan.ok) return invalid
  const earlier: QueryPlan = {
    ...plan.plan,
    title: plan.plan.title.slice(0, MAX_PLAN_TEXT_CHARS),
    explanation: plan.plan.explanation.slice(0, MAX_PLAN_TEXT_CHARS),
  }
  delete earlier.cannotApply
  return { ok: true, value: { question, plan: earlier } }
}
