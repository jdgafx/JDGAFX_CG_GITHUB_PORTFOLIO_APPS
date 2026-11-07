import { describe, expect, it } from 'vitest'
import { RELEVANCE_TIMEOUT_MS, RETRIEVE_TIMEOUT_MS, retrieveSources } from '../../netlify/shared/retrieve'
import { EXTRA_QUESTIONS, REAL_QUESTIONS } from './questions'

// LIVE: this reaches Tavily, arXiv, Hacker News, Wikipedia and the relevance model on OpenRouter. It needs TAVILY_API_KEY and
// OPENROUTER_API_KEY in the environment (tests/live/run-live.sh loads them), and it fails (it does not skip) when one is missing.
// Questions of your own go in AGENTFLOW_EXTRA_QUESTIONS, separated by "|". Each question prints one LIVE line with the
// title of every kept source, so a reader can see whether the sources are about the question.

const GIBBERISH = 'qzxv blorptangle wumbleflux snarfdoodle plinkgrobble'
/** A little room over the two caps for the final bookkeeping after the last step settles. */
const SLACK_MS = 500

async function run(question: string) {
  const started = Date.now()
  const result = await retrieveSources(question, { signal: new AbortController().signal })
  const ms = Date.now() - started
  const perSite: Record<string, number> = {}
  for (const source of result.sources) perSite[source.site] = (perSite[source.site] ?? 0) + 1
  const kept = result.sources.map(source => `${source.n}. [${source.site}] ${source.title}`)
  console.log(
    `LIVE ${JSON.stringify({ question, ms, relevanceMs: result.relevanceMs, candidates: result.candidates, judged: result.judged, perSite, web: perSite.Web ?? 0, kept, detail: result.detail })}`,
  )
  return { ...result, ms, perSite }
}

describe('Retrieve against the live services', () => {
  it('has both keys', () => {
    expect(process.env.TAVILY_API_KEY, 'TAVILY_API_KEY must be set for the live check').toBeTruthy()
    expect(process.env.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY must be set for the live check').toBeTruthy()
  })

  for (const question of [...REAL_QUESTIONS, ...EXTRA_QUESTIONS]) {
    it(`finds fresh web results, judged by the relevance call, within the cap: ${question}`, async () => {
      const found = await run(question)
      expect(found.perSite.Web ?? 0, found.detail).toBeGreaterThan(0)
      // The relevance call itself answered: a run that fell back to the search's own order proves nothing about relevance.
      expect(found.judged, found.detail).toBe(true)
      expect(found.sources.length).toBeLessThanOrEqual(8)
      expect(found.ms).toBeLessThanOrEqual(RETRIEVE_TIMEOUT_MS + RELEVANCE_TIMEOUT_MS + SLACK_MS)
      for (const source of found.sources) {
        expect(source.url).toMatch(/^https:\/\//)
        expect(source.snippet.length).toBeLessThanOrEqual(500)
        expect(source.snippet).not.toMatch(/^Image \d+:/m)
        if (source.site === 'arXiv') expect(source.url).not.toMatch(/v\d+$/)
      }
    })
  }

  it('finds nothing for a nonsense question, and shows no unrelated source', async () => {
    const found = await run(GIBBERISH)
    expect(found.sources).toEqual([])
    expect(found.detail).toMatch(/no sources found/i)
  })
})
