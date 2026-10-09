import { afterEach, describe, expect, it, vi } from 'vitest'
import { ALLOWED_SITE_NOTES, ALLOWED_SITES, MAX_TASK_CHARS, PRESETS } from '../../src/lib/constants'
import { allowedDomains, isAllowedHost } from '../../netlify/shared/domains'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('example tasks', () => {
  it('name only allowlisted sites, and each one names at least one', () => {
    vi.stubEnv('ALLOWED_DOMAINS', '')
    const domains = allowedDomains()
    for (const preset of PRESETS) {
      const hosts = preset.toLowerCase().match(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) ?? []
      expect(hosts.length, preset).toBeGreaterThan(0)
      for (const host of hosts) {
        expect(isAllowedHost(host, domains), `${preset} names ${host}`).toBe(true)
      }
    }
  })

  it('fits the task limit and has no duplicates', () => {
    expect(MAX_TASK_CHARS).toBe(500)
    for (const preset of PRESETS) {
      expect(preset.length).toBeLessThanOrEqual(MAX_TASK_CHARS)
    }
    expect(new Set(PRESETS).size).toBe(PRESETS.length)
  })
})

describe('allowed sites shown on the page', () => {
  it('match the default allowlist the server enforces when no override is set', () => {
    vi.stubEnv('ALLOWED_DOMAINS', '')
    expect(ALLOWED_SITES).toEqual(allowedDomains())
  })

  it('include the public sites the example tasks read, each with a note', () => {
    expect(ALLOWED_SITES).toEqual(expect.arrayContaining(['en.wikipedia.org', 'news.ycombinator.com']))
    for (const site of ALLOWED_SITE_NOTES) expect(site.note.length, site.host).toBeGreaterThan(0)
  })

  it('refuse a lookalike of a newly allowed host', () => {
    vi.stubEnv('ALLOWED_DOMAINS', '')
    const domains = allowedDomains()
    expect(isAllowedHost('news.ycombinator.com.evil.example', domains)).toBe(false)
    expect(isAllowedHost('notwikipedia.org', domains)).toBe(false)
    expect(isAllowedHost('de.wikipedia.org', domains)).toBe(false)
    expect(isAllowedHost('en.wikipedia.org', domains)).toBe(true)
    expect(isAllowedHost('github.com', domains)).toBe(false)
  })
})
