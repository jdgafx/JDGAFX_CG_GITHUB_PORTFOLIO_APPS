import { describe, expect, it } from 'vitest'
import { EXTRA_QUESTIONS, REAL_QUESTIONS } from './questions'

// LIVE, against a running copy of the app: one full run per real question, as a visitor's page does it. The copy is a Netlify
// draft deploy or `netlify dev` on this machine (the function then uses the site's own keys).
//   AGENTFLOW_DRAFT_URL=https://<draft-id>--jdgafx-app-01-multi-agent-orchestrator.netlify.app npm run test:live -- tests/live/draft-run.test.ts
//   AGENTFLOW_DRAFT_URL=http://localhost:8888 npm run test:live -- tests/live/draft-run.test.ts
// It fails (it does not skip) when the address is missing. Each run costs one research run and one audit.

const BASE = (process.env.AGENTFLOW_DRAFT_URL ?? '').replace(/\/+$/, '')

interface Frame { type: string; [key: string]: unknown }
interface Src { n: number; site: string; title: string; url: string }

async function research(query: string) {
  const res = await fetch(`${BASE}/api/ai`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) })
  expect(res.status).toBe(200)
  const frames = (await res.text())
    .split('\n\n')
    .map(block => block.trim())
    .filter(block => block.startsWith('data: ') && block !== 'data: [DONE]')
    .map(block => JSON.parse(block.slice(6)) as Frame)
  return frames
}

describe('a full run on the draft deploy', () => {
  it('has the draft address', () => {
    expect(BASE, 'AGENTFLOW_DRAFT_URL must be set to the draft deploy address or http://localhost:<port>').toMatch(/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$)/)
  })

  for (const question of [...REAL_QUESTIONS, ...EXTRA_QUESTIONS]) {
    it(`finishes a report with web links, audit marks and links that open: ${question}`, async () => {
      const started = Date.now()
      const frames = await research(question)
      const retrieved = frames.find(frame => frame.type === 'retrieve_complete')
      const done = frames.find(frame => frame.type === 'session_complete')
      expect(done, JSON.stringify(frames.filter(frame => frame.type === 'agent_error'))).toBeTruthy()

      const sources = (retrieved?.sources ?? []) as Src[]
      const report = String(done?.result ?? '')
      const web = sources.filter(source => source.site === 'Web')
      expect(web.length, String(retrieved?.detail)).toBeGreaterThan(0)
      expect(report).toContain('### Sources')
      for (const source of web) expect(report).toContain(`](${source.url})`)

      const audit = await fetch(`${BASE}/api/audit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ report, sources }) })
      expect(audit.status).toBe(200)
      const audited = (await audit.json()) as { claims: Array<{ verdict: string }>; summary: { total: number; supported: number; partly: number; unsupported: number } }
      expect(audited.claims.length).toBeGreaterThan(0)
      expect(audited.claims.every(claim => typeof claim.verdict === 'string')).toBe(true)

      // Do the links open? A page that is gone (404/410), an error or an unreachable host fails; a bot wall (401/403/429) is only recorded.
      const opened: Record<number, string> = {}
      for (const source of sources) {
        const status = await fetch(source.url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AgentFlowCheck/1.0' }, signal: AbortSignal.timeout(15_000) })
          .then(response => response.status)
          .catch(() => 0)
        opened[source.n] = `${source.site} ${status}`
        expect([404, 410, 0].includes(status) || status >= 500, `${source.url} answered ${status}`).toBe(false)
      }
      console.log(`DRAFT ${JSON.stringify({ question, seconds: Math.round((Date.now() - started) / 1000), kept: sources.map(source => `${source.n}. [${source.site}] ${source.title}`), detail: retrieved?.detail, audit: audited.summary, opened })}`)
    })
  }
})
