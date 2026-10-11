import { fetchCommonsFile, searchCommons, type CommonsImage } from './commons'

/** The two Commons calls the Try it button makes. The defaults are the live ones; tests pass stubs. */
export interface TryDeps {
  search: (query: string) => Promise<CommonsImage[]>
  download: (image: CommonsImage) => Promise<File>
}

export type TryOutcome =
  | { status: 'loaded'; file: File; image: CommonsImage; commonsFailed: false }
  | { status: 'failed'; message: string; commonsFailed: boolean }

const NO_PICTURE = 'Wikimedia Commons found no usable picture for the example. Try again.'
const FALLBACK = 'The example picture could not be loaded. Try again.'

/**
 * Searches Commons for the example and downloads the first picture. A search or download that fails is a Commons
 * failure, which the live-data chip shows. A search that finds nothing is not: Commons answered.
 */
export async function loadTryExample(
  query: string,
  deps: TryDeps = { search: searchCommons, download: fetchCommonsFile },
): Promise<TryOutcome> {
  try {
    const image = (await deps.search(query))[0]
    if (!image) return { status: 'failed', message: NO_PICTURE, commonsFailed: false }
    const file = await deps.download(image)
    return { status: 'loaded', file, image, commonsFailed: false }
  } catch (err) {
    return { status: 'failed', message: err instanceof Error ? err.message : FALLBACK, commonsFailed: true }
  }
}
