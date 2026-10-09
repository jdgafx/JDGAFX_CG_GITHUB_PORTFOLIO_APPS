import { isRecord } from './guards'
import { ACCEPTED_TYPES, MAX_FILE_SIZE, fileProblem } from './image'

// Public images from Wikimedia Commons. The browser calls the Commons API (origin=* makes it
// CORS-enabled) and downloads the chosen thumbnail from upload.wikimedia.org, which also sends
// Access-Control-Allow-Origin: *. Nothing here goes through our server.

export interface CommonsImage {
  title: string
  fileName: string
  pageUrl: string
  thumbUrl: string
  mime: string
  width: number
  height: number
  author: string
  licence: string
  licenceUrl: string | null
}

export interface CommonsPreset {
  id: string
  label: string
  query: string
  suits: string
}

// One search per kind of work the four modes do.
export const COMMONS_PRESETS: CommonsPreset[] = [
  { id: 'chart', label: 'A chart', query: 'bar chart statistics', suits: 'Extract reads the numbers and labels.' },
  { id: 'street', label: 'A busy street', query: 'busy city street crowd', suits: 'Describe and Analyze cover a full scene.' },
  { id: 'sign', label: 'A sign with text', query: 'road sign', suits: 'Question can ask what the sign says.' },
]

const API_URL = 'https://commons.wikimedia.org/w/api.php'
// Some matches are filtered out (other media types, originals over 4 MB), so more are asked for than are shown.
const REQUEST_LIMIT = 24
const SHOWN_LIMIT = 12
// Scaled thumbnails are asked for at this width, which keeps a photo well under the 4 MB limit.
const THUMB_WIDTH = 1280
// Result cards show a smaller standard thumbnail size than the one that is analyzed.
const GRID_THUMB_WIDTH = 330
const MAX_QUERY_CHARS = 100
const MAX_TEXT_CHARS = 120
const SEARCH_TIMEOUT_MS = 12_000
const DOWNLOAD_TIMEOUT_MS = 25_000
const IMAGE_HOSTS = ['upload.wikimedia.org', 'thumb.wikimedia.org']
const PAGE_HOST = 'commons.wikimedia.org'
const METADATA = ['ObjectName', 'Artist', 'LicenseShortName', 'LicenseUrl']
const NO_AUTHOR = 'Author not stated'
const NO_LICENCE = 'Licence not stated'

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

// Shown to the visitor as written, so every message says what happened and what to do.
export class CommonsError extends Error {}

export function buildSearchUrl(query: string, limit = REQUEST_LIMIT): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${query.trim().slice(0, MAX_QUERY_CHARS)} filetype:bitmap`,
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: String(THUMB_WIDTH),
    iiextmetadatafilter: METADATA.join('|'),
  })
  return `${API_URL}?${params}`
}

// Commons metadata arrives as HTML. Tags are dropped, then entities decoded, so the text is safe to render.
export function stripHtml(html: string): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole
    })
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS - 1).trimEnd()}…` : text
}

// Wikimedia serves thumbnails only at standard widths, and throttles requests for originals ("use thumbnail images
// instead", HTTP 429). So the page asks for a standard thumbnail wherever the picture is wide enough to have one.
const THUMB_STEPS = [120, 250, 330, 500, 960, 1280]
const THUMB_PATH = /^\/wikipedia\/commons\/thumb\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+)\/\d+px-[^/]+$/
const ORIGINAL_PATH = /^\/wikipedia\/commons\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+)$/
const BITMAP_NAME = /\.(jpe?g|png|webp|gif)$/i

/**
 * The thumbnail of a Commons image at the given width, from either of the two URL forms the API returns: the
 * original (.../commons/a/ab/Name.jpg) or a scaled thumbnail (.../commons/thumb/a/ab/Name.jpg/1280px-Name.jpg).
 * The query string is dropped. Returns null for anything else, including names that are not JPEG, PNG, WebP or GIF
 * (other types carry a rendered suffix such as Name.svg.png and are not requested here).
 */
export function thumbUrlAt(url: string, width: number): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const match = THUMB_PATH.exec(parsed.pathname) ?? ORIGINAL_PATH.exec(parsed.pathname)
  if (!match || !BITMAP_NAME.test(match[2])) return null
  return `${parsed.origin}/wikipedia/commons/thumb/${match[1]}/${match[2]}/${width}px-${match[2]}`
}

/** The picture shown on a result card: a 330 px thumbnail, or the original only when it is already that small. */
export function gridThumbUrl(url: string, sourceWidth: number): string {
  if (sourceWidth <= GRID_THUMB_WIDTH) return url
  return thumbUrlAt(url, GRID_THUMB_WIDTH) ?? url
}

/**
 * Addresses to try, in order, for the picture a pick analyzes. A wide picture arrives from the API as a 1280 px
 * thumbnail already. A narrower one gets the largest standard thumbnail that is no wider than itself, and its
 * original only as the last resort if that fails.
 */
export function downloadUrls(image: Pick<CommonsImage, 'thumbUrl' | 'width'>): string[] {
  if (image.width > THUMB_WIDTH || image.width <= 0) return [image.thumbUrl]
  const step = [...THUMB_STEPS].reverse().find(width => width <= image.width)
  const thumb = step ? thumbUrlAt(image.thumbUrl, step) : null
  return thumb ? [thumb, image.thumbUrl] : [image.thumbUrl]
}

export function isTrustedImageUrl(value: string): boolean {
  return isHttpsOn(value, IMAGE_HOSTS)
}

// Turns the generator=search response into result cards, best match first. Entries that cannot be
// analyzed (other media types, an original over the size limit, unexpected hosts) are left out.
export function parseSearchResponse(json: unknown): CommonsImage[] {
  if (!isRecord(json)) throw new CommonsError('Wikimedia Commons sent a reply that could not be read.')
  if (json.error !== undefined) throw new CommonsError('Wikimedia Commons could not run this search. Try other words.')
  const query = json.query
  const pages: unknown = isRecord(query) ? query.pages : undefined
  if (!Array.isArray(pages)) return []

  const ranked = pages.filter(isRecord).sort((a, b) => numberOr(a.index, 0) - numberOr(b.index, 0))
  const images: CommonsImage[] = []
  for (const page of ranked) {
    const image = readPage(page)
    if (image) images.push(image)
  }
  return images
}

function readPage(page: Record<string, unknown>): CommonsImage | null {
  const info = Array.isArray(page.imageinfo) && isRecord(page.imageinfo[0]) ? page.imageinfo[0] : null
  if (!info || typeof page.title !== 'string') return null
  const { mime, thumburl, descriptionurl } = info
  if (typeof mime !== 'string' || !ACCEPTED_TYPES.includes(mime)) return null
  if (typeof thumburl !== 'string' || !isTrustedImageUrl(thumburl)) return null
  if (typeof descriptionurl !== 'string' || !isHttpsOn(descriptionurl, [PAGE_HOST])) return null

  const width = numberOr(info.width, 0)
  const height = numberOr(info.height, 0)
  // An image narrower than the thumbnail width comes back unscaled, so its own size applies.
  const unscaled = width <= THUMB_WIDTH
  if (unscaled && numberOr(info.size, 0) > MAX_FILE_SIZE) return null

  const meta = isRecord(info.extmetadata) ? info.extmetadata : {}
  const fileName = page.title.replace(/^File:/, '')
  const licenceUrl = metaValue(meta, 'LicenseUrl')
  return {
    title: stripHtml(metaValue(meta, 'ObjectName')) || fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
    fileName,
    pageUrl: descriptionurl,
    thumbUrl: thumburl,
    mime,
    width,
    height,
    author: stripHtml(metaValue(meta, 'Artist')) || NO_AUTHOR,
    licence: stripHtml(metaValue(meta, 'LicenseShortName')) || NO_LICENCE,
    licenceUrl: /^https?:\/\//.test(licenceUrl) ? licenceUrl : null,
  }
}

export async function searchCommons(query: string, signal?: AbortSignal): Promise<CommonsImage[]> {
  const response = await commonsFetch(buildSearchUrl(query), SEARCH_TIMEOUT_MS, signal)
  const body: unknown = await response.json().catch(() => {
    throw new CommonsError('Wikimedia Commons sent a reply that could not be read.')
  })
  return parseSearchResponse(body).slice(0, SHOWN_LIMIT)
}

// Downloads the picture as a File, ready for the same checks as an uploaded file. A thumbnail that cannot be
// fetched is followed by the next address in line; a download that fails the file checks is not retried.
export async function fetchCommonsFile(image: CommonsImage, signal?: AbortSignal): Promise<File> {
  const urls = downloadUrls(image)
  if (!urls.every(isTrustedImageUrl)) throw new CommonsError('This image comes from an address that is not allowed.')
  let last: unknown
  for (const url of urls) {
    let blob: Blob
    try {
      const response = await commonsFetch(url, DOWNLOAD_TIMEOUT_MS, signal)
      blob = await response.blob().catch(() => {
        throw new CommonsError('The image download was interrupted. Try again.')
      })
    } catch (err) {
      if (signal?.aborted || !(err instanceof CommonsError)) throw err
      last = err
      continue
    }
    const type = blob.type.split(';')[0].trim() || image.mime
    const file = new File([blob], image.fileName, { type })
    const problem = fileProblem(file)
    if (problem) throw new CommonsError(problem)
    return file
  }
  throw last
}

async function commonsFetch(url: string, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  const limit = AbortSignal.timeout(timeoutMs)
  let response: Response
  try {
    response = await fetch(url, { signal: signal ? AbortSignal.any([signal, limit]) : limit })
  } catch (err) {
    if (signal?.aborted) throw err
    if (limit.aborted) throw new CommonsError('Wikimedia Commons did not answer in time. Try again.')
    throw new CommonsError('Could not reach Wikimedia Commons. Check your connection and try again.')
  }
  if (response.status === 429) throw new CommonsError('Wikimedia Commons is asking for fewer requests. Wait a moment and try again.')
  if (!response.ok) throw new CommonsError(`Wikimedia Commons answered with HTTP ${response.status}. Try again.`)
  return response
}

function metaValue(meta: Record<string, unknown>, key: string): string {
  const entry = meta[key]
  return isRecord(entry) && typeof entry.value === 'string' ? entry.value : ''
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isHttpsOn(value: string, hosts: string[]): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && hosts.includes(url.hostname)
  } catch {
    return false
  }
}
