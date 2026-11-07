import { describe, expect, it } from 'vitest'
import { RETRIEVE_TIMEOUT_MS, retrieveSources } from '../../netlify/shared/retrieve'
import { EXTRA_QUESTIONS, REAL_QUESTIONS } from './questions'

// LIVE: this reaches Tavily, arXiv, Hacker News and Wikipedia. It needs TAVILY_API_KEY in the environment,
// and it fails (it does not skip) when the key is missing. Questions of your own go in AGENTFLOW_EXTRA_QUESTIONS,
// separated by "|".

const GIBBERISH = 'qzxv blorptangle wumbleflux snarfdoodle plinkgrobble'
/** A little room over the cap for the final bookkeeping after the last lookup settles. */
const SLACK_MS = 500

async function run(question: string) {
  const started = Date.now()
  const result = await retrieveSources(question, { signal: new AbortController().signal })
  const ms = Date.now() - started
  const perSite: Record<string, number> = {}
  for (const source of result.sources) perSite[source.site] = (perSite[source.site] ?? 0) + 1
  console.log(`LIVE ${JSON.stringify({ question, ms, perSite, web: perSite.Web ?? 0, detail: result.detail })}`)
  return { ...result, ms, perSite }
}

describe('Retrieve against the live services', () => {
  it('has the web search key', () => {
    expect(process.env.TAVILY_API_KEY, 'TAVILY_API_KEY must be set for the live check').toBeTruthy()
  })

  for (const question of [...REAL_QUESTIONS, ...EXTRA_QUESTIONS]) {
    it(`finds fresh web results within the cap: ${question}`, async () => {
      const found = await run(question)
      expect(found.perSite.Web ?? 0, found.detail).toBeGreaterThan(0)
      expect(found.sources.length).toBeLessThanOrEqual(8)
      expect(found.ms).toBeLessThanOrEqual(RETRIEVE_TIMEOUT_MS + SLACK_MS)
      for (const source of found.sources) {
        expect(source.url).toMatch(/^https:\/\//)
        expect(source.snippet.length).toBeLessThanOrEqual(500)
      }
    })
  }

  it('finds nothing for a nonsense question, and shows no unrelated source', async () => {
    const found = await run(GIBBERISH)
    expect(found.sources).toEqual([])
    expect(found.detail).toMatch(/no sources found/i)
  })
})
