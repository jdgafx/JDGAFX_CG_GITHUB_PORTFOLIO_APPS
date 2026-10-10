import { describe, expect, it } from 'vitest'
import { decodeText, looksBinary, notTextMessage } from '../../src/lib/upload'

const bytes = (...values: number[]) => new Uint8Array(values)
const ascii = (text: string) => new Uint8Array([...text].map((char) => char.charCodeAt(0)))
/** UTF-16 with a byte-order mark, as Excel and Windows Notepad save "Unicode" text. */
function utf16(text: string, bigEndian = false, mark = true): Uint8Array {
  const out: number[] = mark ? (bigEndian ? [0xfe, 0xff] : [0xff, 0xfe]) : []
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index)
    out.push(...(bigEndian ? [unit >> 8, unit & 0xff] : [unit & 0xff, unit >> 8]))
  }
  return new Uint8Array(out)
}
/** Bytes that look like compressed data: a fixed pseudo-random sequence, so the test never changes. */
function noise(length: number, first: number[] = []): Uint8Array {
  let seed = 12345
  return new Uint8Array(Array.from({ length }, (_, index) => (index < first.length ? (first[index] ?? 0) : ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16) & 0xff)))
}

describe('looksBinary', () => {
  it('flags the first bytes of a PNG, a ZIP/XLSX and the raw bytes of a UTF-16 file, which all hold NUL bytes', () => {
    expect(looksBinary(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52))).toBe(true)
    expect(looksBinary(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0x06, 0))).toBe(true)
    expect(looksBinary(bytes(0xff, 0xfe, 0x61, 0, 0x2c, 0, 0x62, 0))).toBe(true)
  })

  it('flags binary data that has no NUL byte but is full of control bytes', () => {
    const noise = new Uint8Array(1000).map((_, index) => (index % 4 === 0 ? 0x01 + (index % 7) : 0x41 + (index % 20)))
    expect(noise.includes(0)).toBe(false)
    expect(looksBinary(noise)).toBe(true)
  })

  it('reads a NUL that comes after the first few bytes but inside the sample', () => {
    expect(looksBinary(new Uint8Array([...ascii('a,b\n1,2\n'.repeat(200)), 0, 65]))).toBe(true)
  })

  it('passes ordinary CSV text, tabs, Windows line endings, UTF-8 with a BOM and accented letters in Latin-1', () => {
    expect(looksBinary(ascii('city,visits\r\nZurich,4\r\nBern,\t2\r\n'))).toBe(false)
    expect(looksBinary(bytes(0xef, 0xbb, 0xbf, ...ascii('city,visits\nZ'), 0xc3, 0xbc, ...ascii('rich,4\n')))).toBe(false)
    expect(looksBinary(bytes(...ascii('city,visits\nZ'), 0xfc, ...ascii('rich,4\n')))).toBe(false)
  })

  it('treats an empty file as not binary, so the empty-file message still applies', () => {
    expect(looksBinary(new Uint8Array(0))).toBe(false)
  })

  it('only reads the start of a large file', () => {
    const large = new Uint8Array(1_000_000).fill(0x61)
    large[900_000] = 0
    expect(looksBinary(large)).toBe(false)
  })
})

describe('decodeText', () => {
  it('reads a UTF-16 CSV with a byte-order mark, little- or big-endian, as the browser file reader did', () => {
    expect(decodeText(utf16('city,temp\nZürich,12\nOslo,7'))).toBe('city,temp\nZürich,12\nOslo,7')
    expect(decodeText(utf16('city,temp\nZürich,12\nOslo,7', true))).toBe('city,temp\nZürich,12\nOslo,7')
    expect(decodeText(utf16('城市,温度\n苏黎世,12\n'))).toBe('城市,温度\n苏黎世,12\n')
  })

  it('reads UTF-8 with or without a mark and Latin-1 as before', () => {
    expect(decodeText(bytes(0xef, 0xbb, 0xbf, ...ascii('city,visits\nBern,2\n')))).toBe('city,visits\nBern,2\n')
    expect(decodeText(ascii('city,visits\r\nBern,\t2\r\n'))).toBe('city,visits\r\nBern,\t2\r\n')
    expect(decodeText(bytes(...ascii('city,visits\nZ'), 0xfc, ...ascii('rich,4\n')))).toContain('rich,4')
    expect(decodeText(new Uint8Array(0))).toBe('')
  })

  it('refuses a PNG, a ZIP/XLSX and binary data, and a UTF-16 file with no byte-order mark', () => {
    expect(decodeText(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52))).toBeNull()
    expect(decodeText(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0x06, 0))).toBeNull()
    expect(decodeText(utf16('city,temp\nOslo,7', false, false))).toBeNull()
  })

  it('refuses binary data that starts with a UTF-16 mark, which decodes to characters no text holds', () => {
    expect(decodeText(noise(4000, [0xff, 0xfe]))).toBeNull()
    expect(decodeText(noise(4000, [0xfe, 0xff]))).toBeNull()
    expect(decodeText(utf16('a\u0000b,c\n'))).toBeNull()
  })
})

describe('notTextMessage', () => {
  it('names the file and says what to choose instead', () => {
    expect(notTextMessage('chart.csv')).toBe('"chart.csv" is not a text file, so it is not a CSV. Choose a comma-separated values file saved as plain text (UTF-8).')
  })
})
