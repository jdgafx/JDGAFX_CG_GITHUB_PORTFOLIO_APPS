import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Piece from '../../src/components/Piece'
import { checkPiece, markFor, type PieceCheck } from '../../src/lib/check'
import { summarize } from '../../src/lib/run'
import { bodyOf, formatSourcePack, withSources, type SourcePack } from '../../netlify/shared/sourcepack'
import type { CallRecord } from '../../src/lib/api'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const SUMMARY = 'Its intricate deployment was successfully completed on January 4, 2022, ten days after launch, when it was more than 0.8 million kilometers (500,000 mi) away from Earth.'
const PACK: SourcePack = { sources: [{ n: 1, kind: 'wikipedia', title: 'JWST sunshield', url: 'https://en.wikipedia.org/wiki/JWST_sunshield', summary: SUMMARY }], notes: [] }
const PLANTED = 'Once in place, the telescope settled into its operating position, more than 0.8 million kilometers from Earth [1].'
const CONTROL = 'Its deployment was completed on January 4, 2022, ten days after launch [1].'
const POLISH = withSources(`${PLANTED} ${CONTROL}`, PACK, 'Blog Post')
const BODY = bodyOf(POLISH)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const usage = { prompt_tokens: 900, completion_tokens: 300, total_tokens: 1200, cost: 0.0004 }

const done: PieceCheck = {
  key: BODY,
  status: 'done',
  claims: [
    { id: 1, text: PLANTED, verdict: 'partly', reason: 'The source gives the distance at deployment.', uncovered: 'operating position' },
    { id: 2, text: CONTROL, verdict: 'supported', reason: 'ok' },
  ],
}

function html(check: PieceCheck | null, polish = POLISH, stage: 'polish' | 'edit' = 'polish'): string {
  return renderToStaticMarkup(
    <Piece
      topic="JWST"
      outputs={{ sources: formatSourcePack(PACK), [stage]: stage === 'polish' ? polish : bodyOf(polish) }}
      notes={{}}
      running={false}
      runningStage={null}
      outcome={{ kind: 'complete' }}
      hasCalls
      check={check}
      copyNote=""
      onCopy={() => undefined}
      onContinue={() => undefined}
    />,
  )
}

describe('markFor', () => {
  it('uses a verdict only for the sentence with the same number and words', () => {
    expect(markFor(done, 2, CONTROL).view).toBe('confirmed')
    expect(markFor(done, 1, PLANTED).view).toBe('not_confirmed')
    expect(markFor(done, 2, 'Some other sentence [1].').view).toBe('not_checked')
    expect(markFor(done, 3, CONTROL).view).toBe('not_checked')
  })

  it('says a sentence is not checked when there is no check, it is still running, or it failed', () => {
    expect(markFor(null, 1, PLANTED).view).toBe('not_checked')
    expect(markFor({ key: BODY, status: 'checking', claims: [] }, 1, PLANTED).view).toBe('checking')
    expect(markFor({ key: BODY, status: 'failed', claims: [], message: 'x' }, 2, CONTROL)).toEqual({ view: 'not_checked', note: 'x' })
  })
})

describe('the piece with its check', () => {
  it('shows the planted sentence as not confirmed with its reason, and the control as confirmed', () => {
    const page = html(done)
    expect(page).toContain(PLANTED.replace(' [1].', ''))
    expect(page).toContain('data-cite="not_confirmed"')
    expect(page).toContain('Not confirmed')
    expect(page).toContain('Not in the source: operating position')
    expect(page).toContain('data-cite="confirmed"')
    expect(page).toContain('Citation check: 1 of 2 cited sentences confirmed by the text of its source, 1 not confirmed.')
  })

  it('shows the piece with every cited sentence not checked, and says why, when the check failed', () => {
    const page = html({ key: BODY, status: 'failed', claims: [], message: 'The citation check did not answer in time.' })
    expect(page).toContain(PLANTED.replace(' [1].', ''))
    expect(page).not.toContain('data-cite="confirmed"')
    expect(page.match(/class="cite" data-cite="not_checked"/g)).toHaveLength(2)
    expect(page).toContain('The citation check could not run: The citation check did not answer in time. The cited sentences are marked not checked.')
  })

  it('marks every cited sentence checking while the check runs, and confirmed for none', () => {
    const page = html({ key: BODY, status: 'checking', claims: [] })
    expect(page.match(/class="cite" data-cite="checking"/g)).toHaveLength(2)
    expect(page).not.toContain('Confirmed')
    expect(page).toContain('Checking 2 cited sentences')
  })

  it('does not apply a check made on other text, and says the sentences were not checked rather than being checked', () => {
    const page = html({ ...done, key: 'an older piece' })
    expect(page).not.toContain('data-cite="confirmed"')
    expect(page).toContain('have not been checked against their sources')
    expect(page).not.toContain('Checking 2')
    expect(page).toContain('data-cite="not_checked"')
  })

  it('marks the cited sentences of an unfinished version not checked, with a line saying they are checked once polished', () => {
    const page = html(done, POLISH, 'edit')
    expect(page).not.toContain('data-cite="confirmed"')
    expect(page).toContain('once the piece is polished')
  })

  it('renders a piece with no cited sentence as before, with no check line', () => {
    const plain = withSources('Nothing here is cited.', PACK, 'Blog Post')
    const page = renderToStaticMarkup(
      <Piece topic="x" outputs={{ sources: formatSourcePack(PACK), polish: plain }} notes={{}} running={false} runningStage={null} outcome={{ kind: 'complete' }} hasCalls check={null} copyNote="" onCopy={() => undefined} onContinue={() => undefined} />,
    )
    expect(page).not.toContain('data-cite')
    expect(page).not.toContain('cite-line')
  })
})

describe('checkPiece', () => {
  const ok = {
    claims: [{ id: 1, text: PLANTED, verdict: 'partly', reason: 'r', uncovered: 'operating position' }],
    calls: [{ claims: [1], ms: 4100, status: 'ok', detail: '1 of 1 sentence answered.', usage, model: 'anthropic/claude-haiku-5.5', newestModel: 'anthropic/claude-haiku-5.5', modelCheck: 'match' }],
    ms: 4200,
  }

  it('posts the body and the sources to the same origin and returns the verdicts with a record per call', async () => {
    const fetchStub = vi.fn(async () => json(ok))
    vi.stubGlobal('fetch', fetchStub)
    const outcome = await checkPiece(BODY, 'sources text', new AbortController().signal)
    expect(fetchStub).toHaveBeenCalledWith('/api/check', expect.objectContaining({ method: 'POST', body: JSON.stringify({ text: BODY, sources: 'sources text' }) }))
    expect(outcome?.check.status).toBe('done')
    expect(outcome?.check.claims[0]?.verdict).toBe('partly')
    expect(outcome?.records).toHaveLength(1)
    expect(outcome?.records[0]).toMatchObject({ stage: 'check', usage, model: 'anthropic/claude-haiku-5.5', modelCheck: 'match' })
  })

  it('counts the check calls in the run totals, and keeps the written reply as the shown model', () => {
    const writing: CallRecord = { stage: 'polish', row: { name: 'Polish', status: 'ok', ms: 5000, detail: 'x', tokens: 3000, cost: 0.001 }, usage: { prompt_tokens: 2000, completion_tokens: 1000, total_tokens: 3000, cost: 0.001 }, model: 'anthropic/claude-haiku-5.5', newestModel: null, modelCheck: 'match' }
    const lost: CallRecord = { stage: 'check', row: { name: 'Citation check 2 of 2', status: 'failed', ms: 22000, detail: 'No answer' }, usage: null, model: null, newestModel: null, modelCheck: null }
    const checked: CallRecord = { stage: 'check', row: { name: 'Citation check 1 of 2', status: 'ok', ms: 4000, detail: 'ok', tokens: 1200, cost: 0.0004 }, usage, model: 'anthropic/claude-haiku-5.4', newestModel: 'anthropic/claude-haiku-5.5', modelCheck: 'mismatch' }
    const totals = summarize([writing, checked, lost])
    expect(totals.totalTokens).toBe(4200)
    expect(totals.cost).toBeCloseTo(0.0014)
    expect(totals.unreportedCalls).toBe(1)
    expect(totals.modelCalls).toBe(3)
    expect(totals.replyModel).toBe('anthropic/claude-haiku-5.5')
    expect(totals.modelCheck).toBe('mismatch')
  })

  it('fails without losing the piece when the network is down, and counts an unreported call', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const outcome = await checkPiece(BODY, '', new AbortController().signal)
    expect(outcome?.check).toMatchObject({ status: 'failed', claims: [] })
    expect(outcome?.records[0]).toMatchObject({ stage: 'check', usage: null })
  })

  it('reports a server error, and counts a call only when the server says one may have been billed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'The citation check took too long.', unreported: 1 }, 504)))
    const slow = await checkPiece(BODY, '', new AbortController().signal)
    expect(slow?.check).toMatchObject({ status: 'failed', message: 'The citation check took too long.' })
    expect(slow?.records).toHaveLength(1)
    expect(slow?.records[0]).toMatchObject({ usage: null })
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'The request is too large.', unreported: 0 }, 413)))
    const large = await checkPiece(BODY, '', new AbortController().signal)
    expect(large?.records).toHaveLength(0)
  })

  it('counts a call that may have been billed when the platform answers with an error that has no count', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })))
    const outcome = await checkPiece(BODY, '', new AbortController().signal)
    expect(outcome?.check.status).toBe('failed')
    expect(outcome?.records.length).toBeGreaterThan(0)
    expect(outcome?.records.every(record => record.usage === null)).toBe(true)
  })

  it('counts one possible call for each batch of three cited sentences when the whole request is lost', async () => {
    const seven = Array.from({ length: 7 }, (_, i) => `Fact number ${i + 1} [1].`).join(' ')
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))
    const outcome = await checkPiece(seven, '', new AbortController().signal, 40)
    expect(outcome?.records.map(record => record.row.name)).toEqual(['Citation check 1 of 3', 'Citation check 2 of 3', 'Citation check 3 of 3'])
    expect(summarize(outcome?.records ?? []).unreportedCalls).toBe(3)
  })

  it('gives up after the watchdog and counts the call as unreported', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))
    // The timeout of AbortSignal.timeout is a real timer, so the test shortens it.
    const outcome = await checkPiece(BODY, '', new AbortController().signal, 40)
    expect(outcome?.check).toMatchObject({ status: 'failed', message: 'The citation check did not answer in time.' })
    expect(outcome?.records[0]).toMatchObject({ usage: null })
  })

  it('returns nothing when the caller aborted it', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(); throw new DOMException('aborted', 'AbortError') }))
    expect(await checkPiece(BODY, '', controller.signal)).toBeNull()
  })

  it('treats an answer with a malformed claim list as a failed check, not as verdicts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ claims: [{ id: 1, text: PLANTED, verdict: 'confirmed' }], calls: [] })))
    const outcome = await checkPiece(BODY, '', new AbortController().signal)
    expect(outcome?.check.status).toBe('failed')
  })
})
