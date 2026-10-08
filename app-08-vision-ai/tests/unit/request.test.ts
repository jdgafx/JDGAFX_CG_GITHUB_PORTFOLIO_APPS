import { describe, expect, it } from 'vitest'
import {
  buildMessages,
  checkBody,
  checkedDetail,
  maxTokensFor,
  type AnalysisRequest,
} from '../../netlify/shared/request'

const PNG_BASE64 = 'aGVsbG8=' // base64 of "hello"
const valid = { image: PNG_BASE64, mediaType: 'image/png', mode: 'describe' }
const MODE_LIST = 'Unsupported mode. Use one of: describe, analyze, qa, extract.'

function rejection(input: unknown): string {
  const result = checkBody(input)
  if (result.ok) throw new Error('expected the request to be rejected')
  return result.message
}

describe('checkBody', () => {
  it('accepts a describe request and drops any model the client sends', () => {
    expect(checkBody({ ...valid, model: 'openrouter/free' })).toEqual({
      ok: true,
      value: { image: PNG_BASE64, mediaType: 'image/png', mode: 'describe', question: '' },
    })
  })

  it('trims the question and keeps it for Question mode', () => {
    expect(checkBody({ ...valid, mode: 'qa', question: '  What does the sign say?  ' })).toEqual({
      ok: true,
      value: { image: PNG_BASE64, mediaType: 'image/png', mode: 'qa', question: 'What does the sign say?' },
    })
  })

  it('accepts an image exactly at the 4 MB base64 limit and rejects one character more', () => {
    const atLimit = 'A'.repeat(5_592_408)
    expect(checkBody({ ...valid, image: atLimit }).ok).toBe(true)
    expect(rejection({ ...valid, image: `${atLimit}A` })).toBe('Image is too large. Please use an image under 4MB.')
  })

  it.each([
    ['a non-object body', 'hello', 'Request body must be a JSON object.'],
    ['a null body', null, 'Request body must be a JSON object.'],
    ['a missing image', { mediaType: 'image/png', mode: 'describe' }, 'An image is required.'],
    ['an empty image', { ...valid, image: '' }, 'An image is required.'],
    [
      'a data URL in place of base64',
      { ...valid, image: 'data:image/png;base64,aGVsbG8=' },
      'Send the image as base64 data with its mediaType, not as a data URL.',
    ],
    ['text that is not base64', { ...valid, image: 'aGVs bG8=' }, 'The image data is not valid base64.'],
    ['an unknown mode', { ...valid, mode: 'translate' }, MODE_LIST],
    ['a missing mode', { ...valid, mode: undefined }, MODE_LIST],
    [
      'a text media type',
      { ...valid, mediaType: 'text/plain' },
      'Unsupported image format: text/plain. Use JPG, PNG, WebP, or GIF.',
    ],
    [
      'a missing media type',
      { ...valid, mediaType: undefined },
      'Unsupported image format: unknown. Use JPG, PNG, WebP, or GIF.',
    ],
    [
      'a Question request with a blank question',
      { ...valid, mode: 'qa', question: '   ' },
      'A question is required for the Question mode.',
    ],
    [
      'a question over 1000 characters',
      { ...valid, mode: 'qa', question: 'x'.repeat(1001) },
      'Question is too long. Keep it under 1000 characters.',
    ],
    ['a question that is not text', { ...valid, mode: 'qa', question: 42 }, 'Question must be text.'],
  ])('rejects %s', (_label, input, message) => {
    expect(rejection(input)).toBe(message)
  })
})

describe('buildMessages', () => {
  const base = { image: PNG_BASE64, mediaType: 'image/png' }

  it('sends the describe prompt with the image as a base64 data URL', () => {
    const request: AnalysisRequest = { ...base, mode: 'describe', question: '' }
    expect(buildMessages(request)).toEqual([
      { role: 'system', content: expect.stringContaining('rich, detailed description') },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
          { type: 'text', text: 'Please analyze this image as requested.' },
        ],
      },
    ])
  })

  it.each([
    ['analyze', 'technical analysis of this image'],
    ['extract', 'Extract all text, numbers, data, tables'],
  ] as const)('uses the %s prompt', (mode, phrase) => {
    const [system] = buildMessages({ ...base, mode, question: '' })
    expect(system).toEqual({ role: 'system', content: expect.stringContaining(phrase) })
  })

  it('puts the question in the system prompt and as the user text in Question mode', () => {
    const messages = buildMessages({ ...base, mode: 'qa', question: 'What words and number appear?' })
    expect(messages[0]).toEqual({
      role: 'system',
      content: 'Answer the following question about this image concisely and accurately: What words and number appear?',
    })
    expect(messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
        { type: 'text', text: 'What words and number appear?' },
      ],
    })
  })
})

describe('maxTokensFor', () => {
  it('gives extraction the larger output budget', () => {
    expect(maxTokensFor('extract')).toBe(8192)
    expect(maxTokensFor('describe')).toBe(4096)
    expect(maxTokensFor('analyze')).toBe(4096)
    expect(maxTokensFor('qa')).toBe(4096)
  })
})

describe('checkedDetail', () => {
  it('names the mode, media type and approximate size of the image', () => {
    const request: AnalysisRequest = { image: 'a'.repeat(4096), mediaType: 'image/jpeg', mode: 'extract', question: '' }
    expect(checkedDetail(request)).toBe('Extract, image/jpeg, about 3 KB')
  })
})
