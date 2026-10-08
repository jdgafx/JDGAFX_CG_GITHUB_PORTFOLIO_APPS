const DEFAULT_ALLOWED_DOMAINS = ['google.com', 'www.google.com', 'flights.google.com']

const PRIVATE_HOST = /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./

/** Hostnames the browser may visit. BROWSERBASE_ALLOWED_DOMAINS, when set, replaces the default list. */
export function allowedDomains(): string[] {
  return (process.env.BROWSERBASE_ALLOWED_DOMAINS ?? DEFAULT_ALLOWED_DOMAINS.join(','))
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean)
}

/** True for an allowed domain or a subdomain of one, and never for a private address. */
export function isAllowedHost(hostname: string, domains: string[]): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || PRIVATE_HOST.test(host)) return false
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}
