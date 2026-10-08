import type { Chunk, Merged, Summary } from '../../src/types/frames'
import type { ChatMessage } from './openrouter'

const EXTRACT_SYSTEM =
  'You read one chunk of a longer document and extract its key points. Reply with a JSON object only: ' +
  '{"points": ["..."], "entities": ["..."]}. "points": up to 5 short statements of the chunk\'s main claims, ' +
  'facts or rules, each under 25 words. "entities": up to 10 named people, groups, places, documents or defined ' +
  'terms that appear in the chunk. Use only what the chunk states.'

const SYNTH_SYSTEM =
  'You write a structured summary of a document from key points extracted chunk by chunk. Reply with a JSON ' +
  'object only: {"overview": "one or two sentences", "sections": [{"heading": "short title", "points": ' +
  '[{"text": "one sentence", "chunks": [chunk numbers]}]}]}. Use 3 to 5 sections with 2 to 4 points each. ' +
  'Every point lists the chunk numbers it draws on. Cite every chunk number at least once. Use only the key ' +
  'points given and add no facts.'

const CHECK_SYSTEM =
  'You check whether a summary leaves out any key point it was built from. Reply with a JSON object only: ' +
  '{"omitted": [chunk numbers whose key points the summary leaves out entirely]}. Reply {"omitted": []} when ' +
  'every chunk listed is reflected in the summary.'

function keyPointLines(merged: Merged): string {
  return merged.byChunk.map((c) => `[chunk ${c.chunkId}] ${c.points.join(' ')}`).join('\n')
}

export function extractMessages(chunk: Chunk, total: number): ChatMessage[] {
  return [
    { role: 'system', content: EXTRACT_SYSTEM },
    { role: 'user', content: `Chunk ${chunk.id} of ${total}:\n\n${chunk.text}` },
  ]
}

/** `missed` lists chunks the previous check left out. The retry pass asks for them by number. */
export function synthesizeMessages(merged: Merged, chunkIds: number[], missed: number[]): ChatMessage[] {
  let user = `Chunk numbers: ${chunkIds.join(', ')}.\n\nKey points by chunk:\n${keyPointLines(merged)}`
  if (missed.length > 0) {
    user += `\n\nThe previous draft did not cite chunk ${missed.join(', ')}. Cite each of them in at least one point.`
  }
  return [
    { role: 'system', content: SYNTH_SYSTEM },
    { role: 'user', content: user },
  ]
}

/** The summary as plain text, with each point's chunk citations, for the review model. */
export function summaryText(summary: Summary): string {
  const lines = [summary.overview]
  for (const section of summary.sections) {
    lines.push(`${section.heading}:`)
    for (const point of section.points) {
      const cite = point.chunks.length > 0 ? ` [chunk ${point.chunks.join(', ')}]` : ''
      lines.push(`- ${point.text}${cite}`)
    }
  }
  return lines.join('\n')
}

export function checkMessages(summary: Summary, merged: Merged): ChatMessage[] {
  return [
    { role: 'system', content: CHECK_SYSTEM },
    {
      role: 'user',
      content: `Summary:\n${summaryText(summary)}\n\nKey points by chunk:\n${keyPointLines(merged)}`,
    },
  ]
}
