import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_TASK_CHARS, PRESETS } from '../../src/lib/constants'
import { allowedDomains, isAllowedHost } from '../../netlify/shared/domains'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('example tasks', () => {
  it('name only allowlisted sites, and each one names at least one', () => {
    vi.stubEnv('BROWSERBASE_ALLOWED_DOMAINS', '')
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
