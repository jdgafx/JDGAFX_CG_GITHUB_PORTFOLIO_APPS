import type { ReleaseKind } from '../../netlify/shared/contract'

/** A stable release of a package: its version, the UTC day the registry published it, and how big a step it was. */
export interface Release {
  version: string
  date: string
  kind: ReleaseKind
}

/** The service that streams a package's registry record and returns only its release dates. */
const RELEASES_ENDPOINT = '/api/releases'
const REQUEST_TIMEOUT_MS = 25_000
/** A stable version: three numbers and nothing after them. Prereleases and canary builds are left out. */
const STABLE = /^(\d+)\.(\d+)\.(\d+)$/
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T/

export type ReleaseErrorKind = 'timeout' | 'network' | 'too-large' | 'not-found' | 'unexpected'

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

/** The URL of the releases service for a package. */
export const releasesUrl = (name: string): string => `${RELEASES_ENDPOINT}?name=${encodeURIComponent(name)}`

/** A failure kind the service names, or "unexpected". */
const KINDS: readonly ReleaseErrorKind[] = ['timeout', 'network', 'too-large', 'not-found', 'unexpected']

/**
 * Reads a package's release history through the releases service, which streams the registry record (tens of megabytes for
 * busy packages) and sends back only the dates. Rethrows the caller's own abort; every other failure is a ReleaseError
 * whose message says what happened, including when a record is too large.
 */
export async function fetchReleases(name: string, signal?: AbortSignal): Promise<Release[]> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const both = signal ? AbortSignal.any([signal, timeout]) : timeout
  try {
    const response = await fetch(releasesUrl(name), { signal: both })
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: unknown; kind?: unknown } | null
      const kind = KINDS.includes(body?.kind as ReleaseErrorKind) ? (body?.kind as ReleaseErrorKind) : 'unexpected'
      const message = typeof body?.error === 'string' ? body.error : `The releases service answered with an error (HTTP ${response.status}).`
      throw new ReleaseError(kind, message)
    }
    return parseReleases(await response.json())
  } catch (err) {
    if (err instanceof ReleaseError) throw err
    if (signal?.aborted) throw err
    if (timeout.aborted) throw new ReleaseError('timeout', `The releases service did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`)
    if (err instanceof SyntaxError) throw new ReleaseError('unexpected', 'The releases service sent a reply this page could not read.')
    throw new ReleaseError('network', 'Could not reach the releases service.')
  }
}
