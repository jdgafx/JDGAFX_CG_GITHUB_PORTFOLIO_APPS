/** The official Hacker News API (no key). The page reads it straight from the visitor's browser: no model call, no server of ours. */
const API = 'https://hacker-news.firebaseio.com/v0'
const FRONT_PAGE_COUNT = 10
/** Ids read beyond the count, so a deleted or dead story does not leave a gap. */
const SPARE = 5
const TIMEOUT_MS = 8_000

export interface HnStory {
  id: number
  title: string
  /** The story's own address, or the discussion when the story is text only. */
  href: string
  /** Host of the story's address. Null for a text post. */
  host: string | null
  score: number
  comments: number
}

type Rec = Record<string, unknown>

const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value)

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** A story from an item the API returned, or null when the item is missing, dead, deleted or not a story. */
export function storyOf(raw: unknown): HnStory | null {
  if (!isRec(raw) || raw.type !== 'story' || raw.dead === true || raw.deleted === true) return null
  const { id, title, url, score, descendants } = raw
  if (typeof id !== 'number' || !Number.isInteger(id) || typeof title !== 'string' || title.trim() === '') return null
  const discussion = `https://news.ycombinator.com/item?id=${id}`
  const outside = typeof url === 'string' && /^https?:\/\//.test(url) ? url : null
  return {
    id,
    title: title.trim(),
    href: outside ?? discussion,
    host: outside ? hostOf(outside) : null,
    score: typeof score === 'number' && score >= 0 ? score : 0,
    comments: typeof descendants === 'number' && descendants >= 0 ? descendants : 0,
  }
}

async function getJson(path: string, signal: AbortSignal, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(`${API}/${path}.json`, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
  if (!response.ok) throw new Error(`Hacker News answered ${response.status}`)
  return response.json()
}

/** The first stories of the front page, in rank order. Throws when the API cannot be read or names no story. */
export async function fetchFrontPage(fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<HnStory[]> {
  const limit = AbortSignal.timeout(TIMEOUT_MS)
  const both = signal ? AbortSignal.any([signal, limit]) : limit
  const ids = await getJson('topstories', both, fetchImpl)
  if (!Array.isArray(ids)) throw new Error('Hacker News sent no story list')
  const wanted = ids.filter((id): id is number => typeof id === 'number').slice(0, FRONT_PAGE_COUNT + SPARE)
  const items = await Promise.all(wanted.map((id) => getJson(`item/${id}`, both, fetchImpl).catch(() => null)))
  const stories = items.flatMap((item) => storyOf(item) ?? []).slice(0, FRONT_PAGE_COUNT)
  if (stories.length === 0) throw new Error('Hacker News sent no readable story')
  return stories
}
