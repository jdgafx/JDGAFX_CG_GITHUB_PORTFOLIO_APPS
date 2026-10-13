import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const toml = readFileSync(new URL('../../netlify.toml', import.meta.url), 'utf8')
const csp = /Content-Security-Policy\s*=\s*"([^"]*)"/.exec(toml)?.[1] ?? ''
const directives = new Map(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.split(/\s+/)[0]!, d.split(/\s+/).slice(1)] as const))

describe('Content-Security-Policy in netlify.toml', () => {
  it('is the portfolio policy, with the one extra connect host', () => {
    expect(directives.get('default-src')).toEqual(["'self'"])
    expect(directives.get('base-uri')).toEqual(["'self'"])
    expect(directives.get('object-src')).toEqual(["'none'"])
    expect(directives.get('frame-ancestors')).toEqual(["'none'"])
    expect(directives.get('form-action')).toEqual(["'self'"])
    expect(directives.get('img-src')).toEqual(["'self'", 'data:'])
    expect(directives.get('script-src')).toEqual(["'self'"])
    expect(directives.get('style-src')).toEqual(["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'])
    expect(directives.get('font-src')).toEqual(["'self'", 'https://fonts.gstatic.com'])
    expect(directives.get('connect-src')).toEqual(["'self'", 'https://api.npmjs.org', 'https://raw.githubusercontent.com'])
  })
  it('lets no script run from anywhere but the app itself', () => {
    expect(csp).not.toContain("'unsafe-eval'")
    expect(directives.get('script-src')).not.toContain("'unsafe-inline'")
  })
})
