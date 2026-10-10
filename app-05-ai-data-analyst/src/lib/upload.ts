/** How much of a file is read to decide whether it is text. */
const SAMPLE_BYTES = 8192
/** The share of control bytes (or, in decoded UTF-16, of characters that never occur in text) above which a file is not text. Text holds almost none; images, archives and spreadsheets hold many. */
const MAX_ODD_SHARE = 0.02

type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be'

/** The encoding a byte-order mark announces, as `FileReader.readAsText` chose it. A file with no mark is read as UTF-8. */
function encodingOf(bytes: Uint8Array): Encoding {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  return 'utf-8'
}

function isControlByte(byte: number): boolean {
  return byte < 9 || byte === 11 || (byte > 13 && byte < 32) || byte === 127
}

/**
 * True when the file's first bytes are not text. A NUL byte never occurs in a UTF-8 or Latin-1 text file (it is how PNG,
 * ZIP, XLSX and PDF headers begin), and a run of other control bytes marks compressed or binary data. Accented letters in
 * a Latin-1 or UTF-8 CSV are not control bytes, so those files still load. A UTF-16 file writes a NUL byte for every ASCII
 * letter, so it is judged after it is decoded (`decodeText`), not here.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, SAMPLE_BYTES)
  let control = 0
  for (const byte of sample) {
    if (byte === 0) return true
    if (isControlByte(byte)) control += 1
  }
  return sample.length > 0 && control / sample.length > MAX_ODD_SHARE
}

/** A decoded character that never occurs in text: a control code, the replacement character, a private-use code or a noncharacter. */
function isOddCharacter(code: number): boolean {
  return isControlByte(code) || code === 0xfffd || (code >= 0xe000 && code <= 0xf8ff) || code === 0xfffe || code === 0xffff
}

/** True when decoded UTF-16 is not text: a NUL, or many characters no text holds (random bytes read as UTF-16 give lone surrogates and private-use codes). */
function decodedLooksBinary(text: string): boolean {
  const sample = text.slice(0, SAMPLE_BYTES / 2)
  let odd = 0
  for (let index = 0; index < sample.length; index += 1) {
    const code = sample.charCodeAt(index)
    if (code === 0) return true
    if (isOddCharacter(code)) odd += 1
  }
  return sample.length > 0 && odd / sample.length > MAX_ODD_SHARE
}

/**
 * The text of an uploaded file, or null when it is not text. A UTF-16 file with a byte-order mark (what Excel and
 * Windows Notepad save as "Unicode") is decoded as UTF-16, as the browser's own file reader does. Every other file is read
 * as UTF-8 once its bytes pass `looksBinary`. A file that is not text is never parsed, so nothing about it reaches the model.
 */
export function decodeText(bytes: Uint8Array): string | null {
  const encoding = encodingOf(bytes)
  if (encoding === 'utf-8') return looksBinary(bytes) ? null : new TextDecoder('utf-8').decode(bytes)
  const text = new TextDecoder(encoding).decode(bytes)
  return decodedLooksBinary(text) ? null : text
}

/** What the page says when a chosen file is not text. Nothing is read further or sent anywhere. */
export function notTextMessage(fileName: string): string {
  return `"${fileName}" is not a text file, so it is not a CSV. Choose a comma-separated values file saved as plain text (UTF-8).`
}
