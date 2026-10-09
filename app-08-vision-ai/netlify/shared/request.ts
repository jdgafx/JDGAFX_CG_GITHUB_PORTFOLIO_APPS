import { isRecord } from './guards'
import type { ChatMessage } from './provider'

const ANALYSIS_MODES = ['describe', 'analyze', 'qa', 'extract', 'region', 'compare'] as const
type AnalysisMode = (typeof ANALYSIS_MODES)[number]

const MODE_LABELS: Record<AnalysisMode, string> = {
  describe: 'Describe',
  analyze: 'Analyze',
  qa: 'Question',
  extract: 'Extract',
  region: 'Region',
  compare: 'Compare',
}

// Where a region crop came from in its source picture, in source pixels. The model is told so it knows the image is a part.
export interface RegionInfo {
  sourceWidth: number
  sourceHeight: number
  x: number
  y: number
  width: number
  height: number
}

export interface AnalysisRequest {
  image: string
  mediaType: string
  mode: AnalysisMode
  question: string
  image2?: string
  mediaType2?: string
  region?: RegionInfo
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
// Two images share one 6 MB request body, so each image of a comparison is limited to 2 MB (the page shrinks them to fit).
export const MAX_COMPARE_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_COMPARE_IMAGE_CHARS = Math.ceil(MAX_COMPARE_IMAGE_BYTES / 3) * 4
const MAX_PIXELS = 100_000

const MAX_TOKENS_DEFAULT = 4096
const MAX_TOKENS_EXTRACT = 8192
const MAX_TOKENS_REGION = 2048
const MAX_TOKENS_COMPARE = 3072

const SYSTEM_PROMPTS: Record<'describe' | 'analyze' | 'extract', string> = {
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
  const { image, mediaType, mode, question, image2, mediaType2, region } = input
  if (typeof image !== 'string' || image === '') return rejected('An image is required.')
  const comparing = mode === 'compare'
  if (image.length > (comparing ? MAX_COMPARE_IMAGE_CHARS : MAX_IMAGE_CHARS)) return rejected(TOO_LARGE_MESSAGE)
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
  if ((mode === 'qa' || mode === 'region') && !text) {
    return rejected(`A question is required for the ${MODE_LABELS[mode]} mode.`)
  }
  const value: AnalysisRequest = { image, mediaType, mode, question: text }
  if (mode === 'region') {
    const info = readRegion(region)
    if (!info) return rejected('The region needs the size of the picture and of the cut-out part.')
    value.region = info
  }
  if (mode === 'compare') {
    if (typeof image2 !== 'string' || image2 === '') return rejected('Comparing needs a second image.')
    if (image2.length > MAX_COMPARE_IMAGE_CHARS) return rejected(TOO_LARGE_MESSAGE)
    if (!BASE64_PATTERN.test(image2)) return rejected('The second image data is not valid base64.')
    if (typeof mediaType2 !== 'string' || !SUPPORTED_MEDIA_TYPES.includes(mediaType2)) {
      return rejected('The second image must be JPG, PNG, WebP, or GIF.')
    }
    value.image2 = image2
    value.mediaType2 = mediaType2
  }
  return { ok: true, value }
}

export function maxTokensFor(mode: AnalysisMode): number {
  if (mode === 'extract') return MAX_TOKENS_EXTRACT
  if (mode === 'region') return MAX_TOKENS_REGION
  if (mode === 'compare') return MAX_TOKENS_COMPARE
  return MAX_TOKENS_DEFAULT
}

// The one-line detail shown on the "Request checked" trace step.
export function checkedDetail(request: AnalysisRequest): string {
  const kb = (chars: number) => Math.round((chars * 3) / 4 / 1024)
  if (request.mode === 'compare' && request.image2) {
    return `Compare, two images, about ${kb(request.image.length)} KB and ${kb(request.image2.length)} KB`
  }
  return `${MODE_LABELS[request.mode]}, ${request.mediaType}, about ${kb(request.image.length)} KB`
}

const COMPARE_PROMPT =
  'Compare the two images, Image A and Image B. Reply in exactly this markdown and nothing else:\n' +
  '## Similarities\n- one short point per line, at least two\n' +
  '## Differences\n- one short point per line, at least two\n' +
  '## Verdict\none or two sentences that answer the question below; if no question is given, say which image is stronger overall and why.'

function imagePart(mediaType: string, data: string) {
  return { type: 'image_url' as const, image_url: { url: `data:${mediaType};base64,${data}` } }
}

function regionPrompt(question: string, info: RegionInfo): string {
  return (
    `The image you are given is a crop, ${info.width} by ${info.height} pixels, cut from a larger picture of ${info.sourceWidth} by ` +
    `${info.sourceHeight} pixels (its top-left corner was at ${info.x}, ${info.y}). Answer only from what the crop shows, ` +
    `concisely and accurately. If the crop is too small or unclear to answer, say so. Question: ${question}`
  )
}

export function buildMessages(request: AnalysisRequest): ChatMessage[] {
  if (request.mode === 'compare' && request.image2 && request.mediaType2) {
    const ask = request.question ? `Question to answer in the verdict: ${request.question}` : 'No question was given.'
    return [
      { role: 'system', content: COMPARE_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Image A:' },
          imagePart(request.mediaType, request.image),
          { type: 'text', text: 'Image B:' },
          imagePart(request.mediaType2, request.image2),
          { type: 'text', text: ask },
        ],
      },
    ]
  }
  if (request.mode === 'region' && request.region) {
    return [
      { role: 'system', content: regionPrompt(request.question, request.region) },
      {
        role: 'user',
        content: [imagePart(request.mediaType, request.image), { type: 'text', text: request.question }],
      },
    ]
  }
  const system =
    request.mode === 'qa'
      ? `Answer the following question about this image concisely and accurately: ${request.question}`
      : SYSTEM_PROMPTS[request.mode as 'describe' | 'analyze' | 'extract']
  const userText = request.mode === 'qa' ? request.question : 'Please analyze this image as requested.'
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [imagePart(request.mediaType, request.image), { type: 'text', text: userText }],
    },
  ]
}

function readRegion(value: unknown): RegionInfo | null {
  if (!isRecord(value)) return null
  const numbers = ['sourceWidth', 'sourceHeight', 'x', 'y', 'width', 'height'].map(key => value[key])
  if (!numbers.every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_PIXELS)) return null
  const [sourceWidth, sourceHeight, x, y, width, height] = numbers as number[]
  if (width < 1 || height < 1 || sourceWidth < 1 || sourceHeight < 1) return null
  return { sourceWidth, sourceHeight, x, y, width, height }
}

function rejected(message: string): Checked {
  return { ok: false, message }
}

function isAnalysisMode(value: unknown): value is AnalysisMode {
  return typeof value === 'string' && (ANALYSIS_MODES as readonly string[]).includes(value)
}
