import type { ChatMessage } from './provider'

const ANALYSIS_MODES = ['describe', 'analyze', 'qa', 'extract'] as const
type AnalysisMode = (typeof ANALYSIS_MODES)[number]

const MODE_LABELS: Record<AnalysisMode, string> = {
  describe: 'Describe',
  analyze: 'Analyze',
  qa: 'Question',
  extract: 'Extract',
}

export interface AnalysisRequest {
  image: string
  mediaType: string
  mode: AnalysisMode
  question: string
}

type Checked = { ok: true; value: AnalysisRequest } | { ok: false; message: string }

// Netlify caps a function request body at 6 MB. The handler rejects anything larger before parsing it.
export const MAX_BODY_BYTES = 6 * 1024 * 1024
export const TOO_LARGE_MESSAGE = 'Image is too large. Please use an image under 4MB.'

const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
// Base64 writes every 3 bytes as 4 characters, so this is the longest image string a 4 MB file can produce.
const MAX_IMAGE_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
const MAX_QUESTION_CHARS = 1000

const MAX_TOKENS_DEFAULT = 4096
const MAX_TOKENS_EXTRACT = 8192

const SYSTEM_PROMPTS: Record<Exclude<AnalysisMode, 'qa'>, string> = {
  describe:
    'Provide a rich, detailed description of this image. Cover everything you observe: subjects, setting, mood, colors, composition, lighting, and any interesting or notable details.',
  analyze:
    'Provide a thorough technical analysis of this image. Cover: composition and framing, color palette and tones, key objects and their relationships, any visible text, image quality, and overall visual impact.',
  extract:
    'Extract all text, numbers, data, tables, and structured information from this image. Present the extracted content clearly and organized, preserving the original structure where possible.',
}

// Checks every field the browser sends. The client's model field, if any, is ignored.
export function checkBody(input: unknown): Checked {
  if (!isRecord(input)) return rejected('Request body must be a JSON object.')
  const { image, mediaType, mode, question } = input
  if (typeof image !== 'string' || image === '') return rejected('An image is required.')
  if (image.length > MAX_IMAGE_CHARS) return rejected(TOO_LARGE_MESSAGE)
  if (image.startsWith('data:')) {
    return rejected('Send the image as base64 data with its mediaType, not as a data URL.')
  }
  if (!BASE64_PATTERN.test(image)) return rejected('The image data is not valid base64.')
  if (!isAnalysisMode(mode)) return rejected(`Unsupported mode. Use one of: ${ANALYSIS_MODES.join(', ')}.`)
  if (typeof mediaType !== 'string' || !SUPPORTED_MEDIA_TYPES.includes(mediaType)) {
    const shown = typeof mediaType === 'string' && mediaType ? mediaType.slice(0, 40) : 'unknown'
    return rejected(`Unsupported image format: ${shown}. Use JPG, PNG, WebP, or GIF.`)
  }
  if (question !== undefined && question !== null && typeof question !== 'string') {
    return rejected('Question must be text.')
  }
  const text = typeof question === 'string' ? question.trim() : ''
  if (text.length > MAX_QUESTION_CHARS) {
    return rejected(`Question is too long. Keep it under ${MAX_QUESTION_CHARS} characters.`)
  }
  if (mode === 'qa' && !text) return rejected('A question is required for the Question mode.')
  return { ok: true, value: { image, mediaType, mode, question: text } }
}

export function maxTokensFor(mode: AnalysisMode): number {
  return mode === 'extract' ? MAX_TOKENS_EXTRACT : MAX_TOKENS_DEFAULT
}

// The one-line detail shown on the "Request checked" trace step.
export function checkedDetail(request: AnalysisRequest): string {
  const kilobytes = Math.round((request.image.length * 3) / 4 / 1024)
  return `${MODE_LABELS[request.mode]}, ${request.mediaType}, about ${kilobytes} KB`
}

export function buildMessages(request: AnalysisRequest): ChatMessage[] {
  const system =
    request.mode === 'qa'
      ? `Answer the following question about this image concisely and accurately: ${request.question}`
      : SYSTEM_PROMPTS[request.mode]
  const userText = request.mode === 'qa' ? request.question : 'Please analyze this image as requested.'
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${request.mediaType};base64,${request.image}` } },
        { type: 'text', text: userText },
      ],
    },
  ]
}

function rejected(message: string): Checked {
  return { ok: false, message }
}

function isAnalysisMode(value: unknown): value is AnalysisMode {
  return typeof value === 'string' && (ANALYSIS_MODES as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
