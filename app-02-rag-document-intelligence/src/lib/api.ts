import type { AiResponse } from '../types'

function scoreChunks(question: string, chunks: string[]): number[] {
  const qWords = question.toLowerCase().match(/\b\w{3,}\b/g) ?? []
  const qSet = new Set(qWords)

  return chunks.map(chunk => {
    const chunkWords = chunk.toLowerCase().match(/\b\w{3,}\b/g) ?? []
    if (chunkWords.length === 0) return 0
    let hits = 0
    for (const word of chunkWords) {
      if (qSet.has(word)) hits++
    }
    return hits / chunkWords.length
  })
}

function isValidAiResponse(data: unknown): data is AiResponse {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return (
    typeof d['answer'] === 'string' &&
    Array.isArray(d['source_chunk_indices']) &&
    typeof d['confidence'] === 'number'
  )
}

export async function askQuestion(
  question: string,
  chunks: string[],
  documentTitle: string,
): Promise<AiResponse> {
  const scores = scoreChunks(question, chunks)
  const indexed = chunks.map((chunk, i) => ({ chunk, score: scores[i] ?? 0, index: i }))
  indexed.sort((a, b) => b.score - a.score)

  const topChunks = indexed.slice(0, 20)
  const labeledChunks = topChunks.map(t => `[Chunk ${t.index}]:\n${t.chunk}`)

  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      chunks: labeledChunks,
      documentTitle,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API error ${response.status}: ${errorText}`)
  }

  const data: unknown = await response.json()

  if (!isValidAiResponse(data)) {
    throw new Error('Invalid response format from API')
  }

  return data
}
