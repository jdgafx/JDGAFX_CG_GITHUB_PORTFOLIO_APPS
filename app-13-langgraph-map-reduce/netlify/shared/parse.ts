import { z } from 'zod'
import type { Summary, SummaryPoint, SummarySection } from '../../src/types/frames'

/** Limits on what one extraction reply may hold. Request 2 holds the browser's hand-off to the same limits. */
export const MAX_POINTS = 6
export const MAX_ENTITIES = 12
export const MAX_POINT_CHARS = 300
export const MAX_ENTITY_CHARS = 80
const MAX_SECTIONS = 6
const MAX_HEADING_CHARS = 120
const MAX_OVERVIEW_CHARS = 600

/**
 * The first complete JSON object in a model reply. It may sit inside a code fence, after prose, or both.
 * A brace that does not open valid JSON is skipped, and braces inside strings do not count.
 */
export function jsonObject(text: string): unknown {
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    const end = closingBrace(text, start)
    if (end < 0) continue
    try {
      return JSON.parse(text.slice(start, end + 1)) as unknown
    } catch {
      // Not valid JSON from this brace: try the next one.
    }
  }
  return null
}

/** Index of the brace that closes the object opened at `start`, or -1 when it never closes. */
function closingBrace(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i += 1
      else if (ch === '"') inString = false
    } else if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

function cleanList(value: unknown, max: number, chars: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => cleanText(item, chars))
    .filter((item) => item.length > 0)
    .slice(0, max)
}

/** Known chunk ids only, sorted and unique. Numbers and digit strings both count. */
function chunkIds(value: unknown, validIds: number[]): number[] {
  if (!Array.isArray(value)) return []
  const valid = new Set(validIds)
  const found = new Set<number>()
  for (const item of value) {
    const id =
      typeof item === 'number'
        ? item
        : typeof item === 'string' && /^\d+$/.test(item.trim())
          ? Number(item.trim())
          : Number.NaN
    if (Number.isInteger(id) && valid.has(id)) found.add(id)
  }
  return [...found].sort((a, b) => a - b)
}

/**
 * Known key point ids only, unique, in the order given. A string is trimmed and must match an id exactly. A number counts
 * by its text (1.2 is "1.2"), which is safe because a chunk gives at most 6 points, so no id ends in 0.
 */
function pointIds(value: unknown, validIds: string[]): string[] {
  if (!Array.isArray(value)) return []
  const valid = new Set(validIds)
  const found = new Set<string>()
  for (const item of value) {
    const id = typeof item === 'number' ? String(item) : typeof item === 'string' ? item.trim() : ''
    if (valid.has(id)) found.add(id)
  }
  return [...found]
}

export interface Extraction {
  points: string[]
  entities: string[]
}

const extractionShape = z.object({ points: z.unknown().optional(), entities: z.unknown().optional() })

/** Null when the reply holds no JSON object. Empty lists are a valid, empty result. */
export function parseExtraction(text: string): Extraction | null {
  const parsed = extractionShape.safeParse(jsonObject(text))
  if (!parsed.success) return null
  return {
    points: cleanList(parsed.data.points, MAX_POINTS, MAX_POINT_CHARS),
    entities: cleanList(parsed.data.entities, MAX_ENTITIES, MAX_ENTITY_CHARS),
  }
}

const importantShape = z.object({ important: z.unknown().optional() })

/** Ids the review model says matter to the document's main subject, kept only if they are in `validIds` (the unused points). Null when the reply holds no JSON object. */
export function parseImportant(text: string, validIds: string[]): string[] | null {
  const parsed = importantShape.safeParse(jsonObject(text))
  if (!parsed.success) return null
  return pointIds(parsed.data.important, validIds)
}

const summaryShape = z.object({ overview: z.unknown().optional(), sections: z.unknown().optional() })
const sectionShape = z.object({ heading: z.unknown().optional(), points: z.unknown().optional() })
const pointShape = z.object({ text: z.unknown().optional(), chunks: z.unknown().optional() })

/**
 * The structured summary. Each sentence keeps only the chunk numbers that exist. Its key points start empty: which ones a
 * sentence states is judged afterwards (parseStated). Sentences without usable text are dropped, and so are sections
 * left with no sentences. Null when no section survives, which the caller reports as an unreadable summary.
 */
export function parseSummary(text: string, validIds: number[]): Summary | null {
  const parsed = summaryShape.safeParse(jsonObject(text))
  if (!parsed.success || !Array.isArray(parsed.data.sections)) return null
  const sections: SummarySection[] = []
  for (const rawSection of parsed.data.sections.slice(0, MAX_SECTIONS)) {
    const section = sectionShape.safeParse(rawSection)
    if (!section.success || !Array.isArray(section.data.points)) continue
    const points: SummaryPoint[] = []
    for (const rawPoint of section.data.points.slice(0, MAX_POINTS)) {
      const point = pointShape.safeParse(rawPoint)
      if (!point.success) continue
      const body = cleanText(point.data.text, MAX_POINT_CHARS)
      if (!body) continue
      points.push({ text: body, points: [], chunks: chunkIds(point.data.chunks, validIds) })
    }
    const heading = cleanText(section.data.heading, MAX_HEADING_CHARS)
    if (heading && points.length > 0) sections.push({ heading, points })
  }
  if (sections.length === 0) return null
  return { overview: cleanText(parsed.data.overview, MAX_OVERVIEW_CHARS), sections }
}

const statedShape = z.object({ states: z.unknown().optional() })

/**
 * The attribution of one chunk: for each sentence number, the ids of the chunk's key points it states. Ids that are not
 * in `validIds` (the chunk's own points) and sentence numbers outside 1..sentenceCount are dropped, so a forged id or a
 * point of another chunk is never counted. Null when the reply holds no JSON object.
 */
export function parseStated(text: string, sentenceCount: number, validIds: string[]): Map<number, string[]> | null {
  const parsed = statedShape.safeParse(jsonObject(text))
  if (!parsed.success) return null
  const stated = new Map<number, string[]>()
  const entries: unknown[] = Array.isArray(parsed.data.states) ? parsed.data.states : []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const { sentence, points } = entry as { sentence?: unknown; points?: unknown }
    const n = typeof sentence === 'number' ? sentence : typeof sentence === 'string' && /^\d+$/.test(sentence.trim()) ? Number(sentence.trim()) : Number.NaN
    if (!Number.isInteger(n) || n < 1 || n > sentenceCount) continue
    const ids = pointIds(points, validIds)
    if (ids.length > 0) stated.set(n, [...new Set([...(stated.get(n) ?? []), ...ids])])
  }
  return stated
}
