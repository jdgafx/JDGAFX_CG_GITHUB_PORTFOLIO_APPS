import { KIND_LABELS, parseSourcePack, type SourceKind } from '../../netlify/shared/sourcepack'

export type LiveState = 'idle' | 'live' | 'failed'

export interface LiveIndicator {
  state: LiveState
  label: string
  /** The exact hosts the Sources step reads. */
  title: string
}

export interface LiveInput {
  /** The Sources step's output text, once it finished. */
  sources: string | undefined
  /** When the Sources step finished. */
  at: number | null
  contentType: string
  /** True when the run failed inside the Sources step. */
  failedAtSources: boolean
}

export const clock = (at: number): string => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

const HOSTS: Record<SourceKind, string> = { wikipedia: 'en.wikipedia.org', hackernews: 'hn.algolia.com' }

// Hacker News is a technology forum; the Sources step does not search it for marketing copy.
const searched = (contentType: string): SourceKind[] => (contentType === 'Marketing Copy' ? ['wikipedia'] : ['wikipedia', 'hackernews'])
const names = (kinds: SourceKind[]): string => kinds.map(kind => KIND_LABELS[kind]).join(' + ')
const hosts = (kinds: SourceKind[]): string => kinds.map(kind => HOSTS[kind]).join(', ')

/**
 * The masthead chip. It lights only when the Sources step returned at least one parsed source, and names the
 * providers that actually delivered. A Sources step that ended with no source reads failed: the later steps
 * then write general background, which is not live data.
 */
export function liveIndicator({ sources, at, contentType, failedAtSources }: LiveInput): LiveIndicator {
  const wanted = searched(contentType)
  if (sources !== undefined && at !== null) {
    const got = [...new Set(parseSourcePack(sources).sources.map(source => source.kind))]
    if (got.length > 0) return { state: 'live', label: `Live data: ${names(got)} · fetched ${clock(at)}`, title: hosts(got) }
    return { state: 'failed', label: `Live data unavailable: ${names(wanted)}`, title: hosts(wanted) }
  }
  if (failedAtSources) return { state: 'failed', label: `Live data unavailable: ${names(wanted)}`, title: hosts(wanted) }
  return { state: 'idle', label: `Live data: ${names(wanted)}`, title: hosts(wanted) }
}
