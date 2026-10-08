const DEFAULT_ALLOWED_DOMAINS = ['google.com', 'www.google.com', 'flights.google.com']

const PRIVATE_HOST = /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./

function parseDomains(raw: string): string[] {
  return raw
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Hostnames the browser may visit. BROWSERBASE_ALLOWED_DOMAINS replaces the default list when it
 * names at least one host. A blank value keeps the default, so the list is never empty.
 */
export function allowedDomains(): string[] {
  const configured = parseDomains(process.env.BROWSERBASE_ALLOWED_DOMAINS ?? '')
  return configured.length > 0 ? configured : [...DEFAULT_ALLOWED_DOMAINS]
}

/** True for an allowed domain or a subdomain of one, and never for a private address. */
export function isAllowedHost(hostname: string, domains: string[]): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || PRIVATE_HOST.test(host)) return false
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}
