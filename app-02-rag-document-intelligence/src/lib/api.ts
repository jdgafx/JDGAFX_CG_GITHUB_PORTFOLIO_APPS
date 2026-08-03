import { TOP_K } from './constants'

/**
 * Words carried by almost every question and almost every passage. Left in the
 * term set they swamp the signal, so a question about "revenue" would rank on
 * "what" and "the" instead.
 */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her', 'was', 'one',
  'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old',
  'see', 'two', 'who', 'did', 'yes', 'she', 'they', 'them', 'this', 'that', 'these', 'those',
  'with', 'from', 'have', 'been', 'were', 'what', 'when', 'where', 'which', 'while', 'does',
  'doing', 'about', 'into', 'over', 'than', 'then', 'there', 'their', 'would', 'could',
  'should', 'will', 'your', 'yours', 'been', 'being', 'here', 'more', 'most', 'some', 'such',
  'only', 'very', 'much', 'many', 'each', 'other', 'also', 'just', 'like', 'tell', 'say',
  'says', 'said', 'give', 'please', 'document', 'documents', 'text', 'file', 'page', 'pages',
])

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/\b[a-z0-9]{3,}\b/g) ?? []
}

/** Distinct content words from the question, falling back to raw tokens if the
 * question is nothing but stop words ("what is this about?"). */
export function questionTerms(question: string): Set<string> {
  const all = tokenize(question)
  const meaningful = all.filter(w => !STOP_WORDS.has(w))
  return new Set(meaningful.length > 0 ? meaningful : all)
}

/**
 * Rank by how much of the question a passage actually covers -- the share of
 * distinct question terms it contains. Scoring by hit *rate* instead (hits per
 * word) let a five-word fragment mentioning one term outrank a paragraph that
 * answered the whole question.
 *
 * A sub-step density bonus breaks ties between equal-coverage passages. It is
 * scaled below one coverage step, so more distinct matches always wins.
 */
export function scoreChunk(chunk: string, qSet: Set<string>): number {
  if (qSet.size === 0) return 0
  const words = tokenize(chunk)
  if (words.length === 0) return 0

  const matched = new Set<string>()
  let hits = 0
  for (const word of words) {
    if (qSet.has(word)) {
      matched.add(word)
      hits++
    }
  }
  if (matched.size === 0) return 0

  const coverage = matched.size / qSet.size
  const density = hits / Math.sqrt(words.length)
  const step = 1 / qSet.size
  return coverage + 0.4 * step * Math.min(density, 1)
}

export interface RetrievedChunk {
  chunk: string
  index: number
  score: number
}

/** Top-scoring passages, returned in document order so the model reads them
 * the way the author wrote them. */
export function retrieve(question: string, chunks: string[], limit: number = TOP_K): RetrievedChunk[] {
  const qSet = questionTerms(question)
  const scored = chunks
    .map((chunk, index) => ({ chunk, index, score: scoreChunk(chunk, qSet) }))
    .filter(c => c.score > 0)

  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.slice(0, limit).sort((a, b) => a.index - b.index)
}

export type AskResult =
  | { status: 'answered'; answer: string; sourceChunks: number[]; confidence: number }
  | { status: 'no-matches' }

interface ApiPayload {
  answer: string
  source_chunk_indices: number[]
  confidence: number
}

function isApiPayload(data: unknown): data is ApiPayload {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return (
    typeof d['answer'] === 'string' &&
    Array.isArray(d['source_chunk_indices']) &&
    typeof d['confidence'] === 'number'
  )
}

function fallbackMessage(status: number): string {
  if (status === 429) return 'Too many questions in a row. Wait a moment and ask again.'
  if (status === 413) return 'That document section was too large to send. Try a narrower question.'
  if (status >= 500) return 'The document assistant is temporarily unavailable. Please try again.'
  return 'The document assistant could not answer that question. Please try again.'
}

/** Turn a failed response into one plain sentence for the chat bubble, keeping
 * the raw body in the console for debugging. */
async function describeFailure(response: Response): Promise<string> {
  let body = ''
  try {
    body = await response.text()
  } catch {
    // Body already consumed or connection dropped -- status alone will do.
  }
  console.error(`DocMind API error ${response.status}:`, body || '(empty response body)')

  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed === 'object' && parsed !== null) {
      const error = (parsed as Record<string, unknown>)['error']
      if (typeof error === 'string' && error.trim()) return error
    }
  } catch {
    // Not JSON (HTML error page, proxy text) -- fall through to the status text.
  }
  return fallbackMessage(response.status)
}

export async function askQuestion(
  question: string,
  chunks: string[],
  documentTitle: string,
  signal?: AbortSignal,
): Promise<AskResult> {
  const top = retrieve(question, chunks)
  if (top.length === 0) return { status: 'no-matches' }

  const labeledChunks = top.map(t => `[Chunk ${t.index}]:\n${t.chunk}`)

  let response: Response
  try {
    response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, chunks: labeledChunks, documentTitle }),
      ...(signal ? { signal } : {}),
    })
  } catch (err) {
    if (signal?.aborted) throw err
    console.error('DocMind request failed:', err)
    throw new Error('Could not reach the document assistant. Check your connection and try again.')
  }

  if (!response.ok) {
    throw new Error(await describeFailure(response))
  }

  let data: unknown
  try {
    data = await response.json()
  } catch (err) {
    console.error('DocMind response was not JSON:', err)
    throw new Error('The document assistant returned an unreadable response. Please try again.')
  }

  if (!isApiPayload(data)) {
    console.error('DocMind response had an unexpected shape:', data)
    throw new Error('The document assistant returned an unexpected response. Please try again.')
  }

  // The model echoes chunk numbers back as text, so they can be out of range or
  // repeated. Anything that would not resolve to a real passage is dropped.
  const seen = new Set<number>()
  const sourceChunks = data.source_chunk_indices.filter(idx => {
    if (!Number.isInteger(idx) || idx < 0 || idx >= chunks.length || seen.has(idx)) return false
    seen.add(idx)
    return true
  })

  return {
    status: 'answered',
    answer: data.answer,
    sourceChunks,
    confidence: Math.min(1, Math.max(0, data.confidence)),
  }
}
