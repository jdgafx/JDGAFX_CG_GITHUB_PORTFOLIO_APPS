import { describe, expect, it } from 'vitest'
import { ACCEPTED_LABEL, ACCEPTED_TYPES, fileProblem, parseDataUrl } from '../../src/lib/image'

const FOUR_MB = 4 * 1024 * 1024

describe('fileProblem', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])('accepts a %s file', type => {
    expect(fileProblem(new File(['x'], 'picture.bin', { type }))).toBeNull()
  })

  it('rejects other types and names the accepted ones', () => {
    expect(fileProblem(new File(['x'], 'logo.svg', { type: 'image/svg+xml' }))).toBe(
      'Unsupported file type: image/svg+xml. Please use JPG, PNG, WebP, or GIF.',
    )
    expect(fileProblem(new File(['x'], 'noname'))).toBe(
      'Unsupported file type: unknown. Please use JPG, PNG, WebP, or GIF.',
    )
  })

  it('accepts a file of exactly 4 MB and rejects one byte more', () => {
    expect(fileProblem(new File([new Uint8Array(FOUR_MB)], 'big.png', { type: 'image/png' }))).toBeNull()
    expect(fileProblem(new File([new Uint8Array(FOUR_MB + 1)], 'big.png', { type: 'image/png' }))).toBe(
      'Image is too large (4.0 MB). Maximum size is 4 MB.',
    )
  })
})

describe('parseDataUrl', () => {
  it('splits a base64 data URL into its media type and payload', () => {
    expect(parseDataUrl('data:image/png;base64,aGk=')).toEqual({ data: 'aGk=', mediaType: 'image/png' })
    expect(parseDataUrl('data:image/webp;base64,UklGR')).toEqual({ data: 'UklGR', mediaType: 'image/webp' })
  })

  it.each([
    ['no comma', 'data:image/png;base64'],
    ['not a data URL', 'image/png;base64,aGk='],
    ['no media type', 'data:;base64,aGk='],
    ['no base64 marker', 'data:image/png,aGk='],
  ])('returns null when there is %s', (_label, url) => {
    expect(parseDataUrl(url)).toBeNull()
  })
})

describe('accepted image types', () => {
  it('lists exactly the four types the server accepts', () => {
    expect(ACCEPTED_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
    expect(ACCEPTED_LABEL).toBe('JPG, PNG, WebP, or GIF')
  })
})
