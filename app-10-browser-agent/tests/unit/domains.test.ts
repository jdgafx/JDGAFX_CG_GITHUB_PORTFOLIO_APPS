import { afterEach, describe, expect, it, vi } from 'vitest'
import { allowedDomains, isAllowedHost } from '../../netlify/shared/domains'

const DEFAULTS = ['google.com', 'www.google.com', 'flights.google.com']

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('allowedDomains', () => {
  it('returns the default list when the override is blank', () => {
    vi.stubEnv('BROWSERBASE_ALLOWED_DOMAINS', '')
    expect(allowedDomains()).toEqual(DEFAULTS)
  })

  it('reads the override, trimmed and lowercased, without empty entries', () => {
    vi.stubEnv('BROWSERBASE_ALLOWED_DOMAINS', ' Example.com , ,docs.Example.org ')
    expect(allowedDomains()).toEqual(['example.com', 'docs.example.org'])
  })

  it('keeps the default list when the override names no host', () => {
    vi.stubEnv('BROWSERBASE_ALLOWED_DOMAINS', ' , ')
    expect(allowedDomains()).toEqual(DEFAULTS)
  })
})

describe('isAllowedHost', () => {
  it('accepts an allowed host and its subdomains', () => {
    expect(isAllowedHost('google.com', DEFAULTS)).toBe(true)
    expect(isAllowedHost('www.google.com', DEFAULTS)).toBe(true)
    expect(isAllowedHost('flights.google.com', DEFAULTS)).toBe(true)
    expect(isAllowedHost('mail.google.com', DEFAULTS)).toBe(true)
  })

  it('compares hosts without regard to case', () => {
    expect(isAllowedHost('WWW.Google.COM', DEFAULTS)).toBe(true)
  })

  it('rejects look-alike hosts that only end with an allowed name', () => {
    expect(isAllowedHost('evilgoogle.com', DEFAULTS)).toBe(false)
    expect(isAllowedHost('google.com.evil.example', DEFAULTS)).toBe(false)
  })

  it('rejects hosts outside the list', () => {
    expect(isAllowedHost('example.com', DEFAULTS)).toBe(false)
  })

  it('allows nothing when the list is empty', () => {
    expect(isAllowedHost('google.com', [])).toBe(false)
  })

  it('never allows localhost, .local names or private addresses, even when listed', () => {
    const hosts = ['localhost', 'printer.local', '10.0.0.5', '192.168.1.20', '172.16.4.1', '169.254.169.254', '127.0.0.1']
    for (const host of hosts) {
      expect(isAllowedHost(host, hosts), host).toBe(false)
    }
  })
})
