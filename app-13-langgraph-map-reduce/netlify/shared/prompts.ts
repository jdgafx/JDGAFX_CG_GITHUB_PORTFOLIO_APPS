import type { Chunk, KeyPoint, Merged, Summary } from '../../src/types/frames'
import type { ChatMessage } from './openrouter'

/** Added to the extract and synthesis prompts: small models swap who does what to whom. */
export const FAITHFULNESS =
  ' Keep each statement\'s actor and object exactly as the text gives them. Never reverse who does what to ' +
  'whom, and keep who is addressed or blamed.'

const EXTRACT_SYSTEM =
  'You read one chunk of a longer document and extract its key points. Reply with a JSON object only: ' +
  '{"points": ["..."], "entities": ["..."]}. "points": up to 5 short statements of the chunk\'s main claims, ' +
  'facts or rules, each under 25 words. "entities": up to 10 named people, groups, places, documents or defined ' +
  'terms that appear in the chunk. Use only what the chunk states.' +
  FAITHFULNESS

/** The writer cites chunk numbers only. Which key points a sentence states is judged afterwards, chunk by chunk (ATTRIBUTE_SYSTEM). */
const SYNTH_SYSTEM =
  'You write a structured summary of a document from key points extracted chunk by chunk. Reply with a JSON ' +
  'object only: {"overview": "one or two sentences", "sections": [{"heading": "short title", "points": ' +
  '[{"text": "one sentence", "chunks": [chunk numbers]}]}]}. Use 3 to 5 sections with 2 to 4 points each. ' +
  'Keep the overview under 40 words and every point to one sentence under 25 words. ' +
  'Every point lists the chunk numbers it draws on. Cite every chunk number at least once. Use only the key ' +
  'points given and add no facts.' +
  FAITHFULNESS

/** One call per chunk, so each judges at most 6 key points against the finished sentences. */
const ATTRIBUTE_SYSTEM =
  'You check which key points a summary states. You get the numbered sentences of a summary and the key points ' +
  'of one chunk of the document, each with an id in brackets. For each sentence that states one or more of these ' +
  'key points, list their ids. A sentence states a key point only when it says the key point\'s main claim in full, ' +
  'including the cause, mechanism, result, date or number the point gives: a sentence that leaves out the date, number or ' +
  'cause a point gives does not state it. Leaving out a minor detail, such as an example or a name in passing, is fine. ' +
  'A sentence that gives only part of the main claim, or only touches the same topic, does not state it. ' +
  'Reply with a JSON object only: ' +
  '{"states": [{"sentence": 3, "points": ["2.1", "2.4"]}]}. Leave out sentences that state none of them, and use only the ids given.'

const CHECK_SYSTEM =
  'You review a summary of a document. Below the summary are key points extracted from the document that the ' +
  'summary does not state, each with an id in brackets. Decide which of them state something central to the ' +
  'document\'s main subject, so that a reader of the summary would miss a core fact without them. Details, ' +
  'examples and side topics are not central. Reply with a JSON object only: {"important": ["ids of the central ' +
  'key points"]}. Reply {"important": []} when none is central.'

const idLines = (points: KeyPoint[]): string => points.map((p) => `[${p.id}] ${p.text}`).join('\n')

function keyPointLines(merged: Merged): string {
  return merged.byChunk.map((c) => `[chunk ${c.chunkId}] ${c.points.map((p) => p.text).join(' ')}`).join('\n')
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

/** The summary as plain text, without its citations, for the review model. */
export function summaryText(summary: Summary): string {
  const lines = [summary.overview]
  for (const section of summary.sections) {
    lines.push(`${section.heading}:`)
    for (const point of section.points) lines.push(`- ${point.text}`)
  }
  return lines.join('\n')
}

/** The review sees the summary and only the key points it does not use, so it can judge nothing else. */
export function checkMessages(summary: Summary, unused: KeyPoint[]): ChatMessage[] {
  const lines = idLines(unused)
  return [
    { role: 'system', content: CHECK_SYSTEM },
    {
      role: 'user',
      content: `Summary:\n${summaryText(summary)}\n\nKey points the summary does not state:\n${lines}\n\nReply with the JSON object only, no other text.`,
    },
  ]
}

/** The finished summary's numbered sentences and one chunk's key points: the attribution call for that chunk. */
export function attributeMessages(sentences: string[], chunkId: number, points: KeyPoint[]): ChatMessage[] {
  return [
    { role: 'system', content: ATTRIBUTE_SYSTEM },
    {
      role: 'user',
      content: `Summary sentences:\n${sentences.map((text, i) => `${i + 1}. ${text}`).join('\n')}\n\nKey points of chunk ${chunkId}:\n${idLines(points)}\n\nReply with the JSON object only, no other text.`,
    },
  ]
}
