import { z } from 'zod'

/**
 * Reads the first JSON object in a model reply. Code fences and prose around the object
 * are tolerated. Returns undefined when no object parses.
 */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown
  } catch {
    return undefined
  }
}

const PlanReply = z.object({ queries: z.array(z.string()).min(1) })

/** Up to three distinct queries, whitespace collapsed and each cut to 120 characters. */
export function parseQueries(text: string): string[] {
  const parsed = PlanReply.safeParse(extractJson(text))
  if (!parsed.success) return []
  const cleaned = parsed.data.queries
    .map((query) => query.replace(/\s+/g, ' ').trim().slice(0, 120))
    .filter((query) => query !== '')
  return [...new Set(cleaned)].slice(0, 3)
}

const CriticReply = z.object({
  verdict: z.enum(['accept', 'revise']),
  notes: z.string().optional(),
})

export interface CriticVerdict {
  verdict: 'accept' | 'revise'
  notes: string
}

/** The critic's verdict, or null when the reply is not the expected JSON. */
export function parseCritic(text: string): CriticVerdict | null {
  const parsed = CriticReply.safeParse(extractJson(text))
  if (!parsed.success) return null
  return { verdict: parsed.data.verdict, notes: (parsed.data.notes ?? '').trim().slice(0, 600) }
}
