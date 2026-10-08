import type { ChatReply } from './provider'

export const STAGE_IDS = ['research', 'outline', 'draft', 'edit', 'polish'] as const
export type StageId = (typeof STAGE_IDS)[number]

export const STAGE_LABELS: Record<StageId, string> = {
  research: 'Research',
  outline: 'Outline',
  draft: 'Draft',
  edit: 'Edit',
  polish: 'Polish',
}

export const CONTENT_TYPES = ['Blog Post', 'Technical Article', 'Marketing Copy', 'Newsletter', 'Social Thread'] as const

// Earlier stage outputs each stage may read. Keeps prompts bounded while the
// draft still has the research and outline behind it.
export const STAGE_INPUTS: Record<StageId, readonly StageId[]> = {
  research: [],
  outline: ['research'],
  draft: ['research', 'outline'],
  edit: ['outline', 'draft'],
  polish: ['edit'],
}

// The longest stage output the server accepts as input. Longer output is refused
// where it is produced, so the next stage never fails on it.
export const MAX_STAGE_TEXT_CHARS = 8_000

// Word budgets keep each model call short. They, the token ceiling and the call
// timeout together keep one stage well inside the function time limit.
const STAGE_WORD_BUDGETS: Record<StageId, number> = {
  research: 80,
  outline: 100,
  draft: 160,
  edit: 160,
  polish: 160,
}

const STAGE_PROMPTS: Record<StageId, string> = {
  research: 'Produce a tight research brief: the key facts, figures, expert views and background worth using. Dense notes, not prose — no introduction and no conclusion.',
  outline: 'Produce the outline only: section headings with a few bullet points under each. Bullets, never paragraphs, and never any of the finished writing.',
  draft: 'Write the complete piece, following the outline and drawing on the research. Engaging, well-structured, and finished — a real ending, not a stop mid-section.',
  edit: 'Return the full edited piece: fix grammar, tighten flow, strengthen arguments, add transitions, sharpen clarity. Improve what is there — do not add new sections or pad it out. Keep it roughly the same length as the draft.',
  polish: 'Polish the edited piece supplied below and return it complete. Improve it in place: sharpen the opening, tighten the prose, smooth transitions, strengthen the conclusion, hold a consistent professional tone. Preserve its structure, facts and substance — do not rewrite from scratch, do not restart from the topic, and do not make it longer.',
}

const MAX_CONTEXT_CHARS = 1800

// Anything shorter than this is not usable text for any stage.
const MIN_STAGE_WORDS = 5

// Edit and polish must keep roughly the length of the text they were given.
const LENGTH_SOURCE: Partial<Record<StageId, StageId>> = { edit: 'draft', polish: 'edit' }
const MIN_SHARE_OF_SOURCE = 0.5

// Safety models answer with a label such as "User Safety: safe", never with article
// text. Only short replies are checked, so an article that mentions a safety rating is not caught.
const SAFETY_LABEL = /\bsafety\s*:\s*(?:un)?safe\b|^\s*(?:un)?safe\.?\s*$/i
const MAX_LABEL_WORDS = 20

interface StageRejection {
  message: string
  // True only for empty, cut-off or too-short replies, the only ones the browser retries once.
  retryable: boolean
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text
}

function isSafetyLabel(text: string): boolean {
  return wordCount(text) <= MAX_LABEL_WORDS && SAFETY_LABEL.test(text.trim())
}

export function buildSystemPrompt(stage: StageId, topic: string, contentType: string): string {
  return [
    `You are an expert content creator. The user wants a ${contentType} about: "${topic}".`,
    `Current step: ${stage.toUpperCase()}. ${STAGE_PROMPTS[stage]}`,
    `Keep this response to roughly ${STAGE_WORD_BUDGETS[stage]} words, and finish inside that budget.`,
    'Output only the content for this step — no preamble, no commentary on what you are doing. Stop as soon as the requested content is complete; never exceed the word budget.',
  ].join(' ')
}

export function buildUserMessage(
  stage: StageId,
  topic: string,
  contentType: string,
  context: Partial<Record<StageId, string>>,
): string {
  const sections = STAGE_INPUTS[stage]
    .map(input => {
      const content = context[input]?.trim()
      return content ? `## ${STAGE_LABELS[input]}\n${clip(content, MAX_CONTEXT_CHARS)}` : ''
    })
    .filter(Boolean)

  if (sections.length === 0) {
    return `Create a ${contentType} about: ${topic}`
  }
  return `${sections.join('\n\n')}\n\nUsing the material above, ${stage} the ${contentType} about: ${topic}`
}

// Returns why a reply cannot be used as this stage's output, or null when it can.
// The served-model check is ported from app-08: a content-safety model answers
// with a moderation label, which must never be published as the article.
export function rejectOutput(
  stage: StageId,
  reply: Pick<ChatReply, 'content' | 'finishReason' | 'servedModel'>,
  context: Partial<Record<StageId, string>>,
): StageRejection | null {
  if (reply.servedModel?.includes('content-safety') || isSafetyLabel(reply.content)) {
    return { message: 'The AI provider answered with a safety label instead of text, so this stage was discarded.', retryable: false }
  }
  if (!reply.content.trim()) {
    return { message: 'The AI provider returned no text for this stage.', retryable: true }
  }
  if (reply.finishReason === 'length') {
    return { message: 'This stage ran out of room before it finished.', retryable: true }
  }
  if (wordCount(reply.content) < MIN_STAGE_WORDS) {
    return { message: 'This stage returned too little text to use.', retryable: true }
  }
  if (reply.content.trim().length > MAX_STAGE_TEXT_CHARS) {
    return { message: 'This stage wrote more text than the next stage can take, so it was discarded.', retryable: false }
  }
  const source = LENGTH_SOURCE[stage]
  if (source && wordCount(reply.content) < wordCount(context[source] ?? '') * MIN_SHARE_OF_SOURCE) {
    return { message: `This stage returned far less text than the ${STAGE_LABELS[source]} stage it was given, so it was discarded.`, retryable: true }
  }
  return null
}
