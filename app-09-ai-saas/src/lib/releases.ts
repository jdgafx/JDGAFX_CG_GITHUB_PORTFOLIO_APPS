import type { ReleaseKind } from '../../netlify/shared/contract'

/** A stable release of a package: its version, the UTC day the registry published it, and how big a step it was. */
export interface Release {
  version: string
  date: string
  kind: ReleaseKind
}

const REGISTRY = 'https://registry.npmjs.org'
const REQUEST_TIMEOUT_MS = 20_000
/** The registry document of a busy package is several megabytes once decoded. Anything past this is not read. */
const MAX_BYTES = 40_000_000
/** A stable version: three numbers and nothing after them. Prereleases and canary builds are left out. */
const STABLE = /^(\d+)\.(\d+)\.(\d+)$/
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T/

export type ReleaseErrorKind = 'timeout' | 'network' | 'too-large' | 'unexpected'

/** A failed registry read. The message is plain language and safe to show as it is. */
export class ReleaseError extends Error {
  readonly kind: ReleaseErrorKind

  constructor(kind: ReleaseErrorKind, message: string) {
    super(message)
    this.name = 'ReleaseError'
    this.kind = kind
  }
}

/**
 * How big a step a stable version was, from its number alone. From 1.0.0 on: a new first number is major, a new
 * second number is minor, anything else is a patch. Under 1.0.0 the second number carries the breaking changes,
 * so 0.5.0 is minor and 0.5.2 is a patch. The registry does not say what a release contained; this is a reading
 * of the version number.
 */
export function classifyVersion(version: string): ReleaseKind | null {
  const match = STABLE.exec(version)
  if (!match) return null
  const [major, minor, patch] = match.slice(1).map(Number)
  if (patch > 0) return 'patch'
  if (minor > 0) return 'minor'
  return major > 0 ? 'major' : null
}

/**
 * Reads the registry document's `time` map into stable releases, oldest first. `created` and `modified` are
 * not versions. A version whose time is not an ISO timestamp, or that is not x.y.z, is skipped. A document
 * with no `time` map is an error rather than an empty history.
 */
export function parseReleases(json: unknown): Release[] {
  const time = typeof json === 'object' && json !== null ? (json as { time?: unknown }).time : undefined
  if (typeof time !== 'object' || time === null || Array.isArray(time)) {
    throw new ReleaseError('unexpected', 'The npm registry sent a reply this page could not read.')
  }
  const releases: Release[] = []
  for (const [version, stamp] of Object.entries(time)) {
    const kind = classifyVersion(version)
    if (kind === null || typeof stamp !== 'string' || !ISO_TIME.test(stamp)) continue
    releases.push({ version, date: stamp.slice(0, 10), kind })
  }
  return releases.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** The registry document URL. A scoped name is encoded into one path segment. */
export const registryUrl = (name: string): string => `${REGISTRY}/${encodeURIComponent(name)}`

/** Reads a response body to text, giving up past MAX_BYTES. The time limit on the request's signal covers the read. */
async function readCapped(response: Response): Promise<string> {
  if (!response.body) throw new ReleaseError('unexpected', 'The npm registry sent no reply.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > MAX_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new ReleaseError('too-large', 'This package has too much release history for this page to read.')
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

/**
 * Fetches a package's release history. The registry answers browser requests from any origin. Rethrows the
 * caller's own abort; every other failure is a ReleaseError.
 */
export async function fetchReleases(name: string, signal?: AbortSignal): Promise<Release[]> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const both = signal ? AbortSignal.any([signal, timeout]) : timeout
  try {
    const response = await fetch(registryUrl(name), { signal: both })
    if (!response.ok) {
      throw new ReleaseError('unexpected', `The npm registry answered with an error (HTTP ${response.status}).`)
    }
    return parseReleases(JSON.parse(await readCapped(response)))
  } catch (err) {
    if (err instanceof ReleaseError) throw err
    if (signal?.aborted) throw err
    if (timeout.aborted) throw new ReleaseError('timeout', `The npm registry did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`)
    if (err instanceof SyntaxError) throw new ReleaseError('unexpected', 'The npm registry sent a reply this page could not read.')
    throw new ReleaseError('network', 'Could not reach the npm registry.')
  }
}
