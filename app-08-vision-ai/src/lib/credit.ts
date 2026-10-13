import { isTrustedImageUrl, type CommonsImage } from './commons'
import { isRecord } from './guards'
import { ACCEPTED_TYPES } from './image'

const MAX_TEXT_CHARS = 400
const PAGE_HOST = 'commons.wikimedia.org'

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_CHARS
}

function size(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100_000
}

function httpsOnHost(value: unknown, host: string): value is string {
  if (!text(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === host
  } catch {
    return false
  }
}

/**
 * The Commons credit of a picture, read back from a request the page itself once sent (the stored recording of a run).
 * Null unless every field is what the page would have sent: addresses on the Commons hosts only, a bitmap type, short text.
 * The result is a fresh object, so nothing else from the recording rides along.
 */
export function readCredit(value: unknown): CommonsImage | null {
  if (!isRecord(value)) return null
  const { title, fileName, pageUrl, thumbUrl, mime, width, height, author, licence, licenceUrl } = value
  if (!text(title) || !text(fileName) || !text(author) || !text(licence)) return null
  if (!httpsOnHost(pageUrl, PAGE_HOST)) return null
  if (!text(thumbUrl) || !isTrustedImageUrl(thumbUrl)) return null
  if (typeof mime !== 'string' || !ACCEPTED_TYPES.includes(mime)) return null
  if (!size(width) || !size(height)) return null
  if (licenceUrl !== null && !(text(licenceUrl) && /^https?:\/\//.test(licenceUrl))) return null
  return { title, fileName, pageUrl, thumbUrl, mime, width, height, author, licence, licenceUrl }
}
