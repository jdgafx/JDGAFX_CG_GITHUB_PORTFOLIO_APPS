import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const toml = readFileSync(new URL('../../netlify.toml', import.meta.url), 'utf8')
const rules = [...toml.matchAll(/\[\[redirects\]\]\s+from = "([^"]+)"\s+to = "([^"]+)"\s+status = (\d+)/g)].map(m => ({
  from: m[1],
  to: m[2],
  status: Number(m[3]),
}))

describe('netlify.toml', () => {
  it('answers an unknown /api path with 404, ahead of the catch-all that serves the app', () => {
    const api = rules.findIndex(r => r.from === '/api/*')
    const all = rules.findIndex(r => r.from === '/*')
    expect(rules[api]).toMatchObject({ to: '/404.html', status: 404 })
    expect(rules[all]).toMatchObject({ to: '/index.html', status: 200 })
    expect(api).toBeGreaterThanOrEqual(0)
    expect(api).toBeLessThan(all)
  })

  it('lets the browser reach only the two public hosts it calls directly', () => {
    const connect = /connect-src ([^;]+);/.exec(toml)?.[1]
    expect(connect).toBe("'self' https://en.wikipedia.org https://arxiv.org")
  })
})
