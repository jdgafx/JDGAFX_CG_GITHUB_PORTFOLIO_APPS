const DEFAULT_ALLOWED_DOMAINS = ['google.com', 'www.google.com', 'flights.google.com', 'en.wikipedia.org', 'news.ycombinator.com']

const PRIVATE_HOST = /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./

function parseDomains(raw: string): string[] {
  return raw
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Hostnames the browser may visit. ALLOWED_DOMAINS replaces the default list when it
 * names at least one host. A blank value keeps the default, so the list is never empty.
 */
export function allowedDomains(): string[] {
  const configured = parseDomains(process.env.ALLOWED_DOMAINS ?? '')
  return configured.length > 0 ? configured : [...DEFAULT_ALLOWED_DOMAINS]
}

/** True for an allowed domain or a subdomain of one, and never for a private address. */
export function isAllowedHost(hostname: string, domains: string[]): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || PRIVATE_HOST.test(host)) return false
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

/** A host name or an IPv4 address written in free text. A bare word with no dot never matches. */
const HOST_TOKEN = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b|\b(?:\d{1,3}\.){3}\d{1,3}\b/gi

/** The distinct hosts a text names, lower-cased, in the order they first appear. */
export function hostsIn(text: string): string[] {
  return [...new Set((text.match(HOST_TOKEN) ?? []).map((host) => host.toLowerCase()))]
}
