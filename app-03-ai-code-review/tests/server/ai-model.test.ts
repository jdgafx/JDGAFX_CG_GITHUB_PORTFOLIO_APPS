import { describe, expect, it, vi } from 'vitest'
import { MODEL_LIST_URL } from '../../netlify/shared/newest-model'
import {
  CRITICAL_DIVIDE, DEFAULT_USAGE, DIVIDE_BODY, SERVED_MODEL, fetchStub, full, installHooks, keep, listAnswers, listStub, providerReply, readPayload, reply, reviewJson, script, standsFor, twoPasses, verdictJson,
} from './harness'

installHooks()

const NEWER = 'anthropic/claude-haiku-5.5'
const unnamed = (text: string) => () => providerReply(text, 'stop', DEFAULT_USAGE, null)
const servedAs = (text: string, served: string) => () => providerReply(text, 'stop', DEFAULT_USAGE, served)
const VERDICTS = verdictJson([keep(1, 2, 'return a / b')])
const STANDS = verdictJson(standsFor([keep(1, 2, 'return a / b')]))

describe('ai function: the served model against the newest', () => {
  it('reports a served model that is the newest as a match', async () => {
    twoPasses([CRITICAL_DIVIDE], [keep(1, 2, 'return a / b')])
    const payload = await readPayload(await full(DIVIDE_BODY))
    expect(payload).toMatchObject({ success: true, model: SERVED_MODEL, newestModel: SERVED_MODEL, modelCheck: 'match' })
  })

  it('shows a mismatch and warns with the served, newest and requested names, but still returns the review', async () => {
    listAnswers(NEWER)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    twoPasses([CRITICAL_DIVIDE], [keep(1, 2, 'return a / b')])
    const payload = await readPayload(await full(DIVIDE_BODY))
    expect(payload).toMatchObject({ success: true, model: SERVED_MODEL, newestModel: NEWER, modelCheck: 'mismatch' })
    expect(payload.result?.comments[0]).toMatchObject({ verdict: 'kept' })
    expect(warn).toHaveBeenCalledWith(`model mismatch: served ${SERVED_MODEL}, newest ${NEWER}, requested ~anthropic/claude-haiku-latest`)
  })

  it('shows a mismatch when a later pass named an older model, though the review pass matched', async () => {
    const OLDER = 'anthropic/claude-haiku-4.5'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    script({ pass1: [reply(reviewJson([CRITICAL_DIVIDE]))], read1: [servedAs(VERDICTS, OLDER)], read2: [reply(STANDS)] })
    const payload = await readPayload(await full(DIVIDE_BODY))
    expect(payload).toMatchObject({ success: true, model: SERVED_MODEL, newestModel: SERVED_MODEL, modelCheck: 'mismatch' })
    expect(payload.servedModels).toEqual([
      { pass: 'Pass 1: review', model: SERVED_MODEL },
      { pass: 'Pass 2: verify (read 1)', model: OLDER },
      { pass: 'Pass 2: verify (read 2, adversary)', model: SERVED_MODEL },
    ])
    expect(warn).toHaveBeenCalledWith(`model mismatch: served ${OLDER}, newest ${SERVED_MODEL}, requested ~anthropic/claude-haiku-latest`)
  })

  it('answers unchecked when the list gives no answer, and the review is still returned', async () => {
    listAnswers(null)
    twoPasses([CRITICAL_DIVIDE], [keep(1, 2, 'return a / b')])
    const payload = await readPayload(await full(DIVIDE_BODY))
    expect(payload).toMatchObject({ success: true, model: SERVED_MODEL, newestModel: null, modelCheck: 'unchecked' })
    expect(payload.result?.verified).toBe(true)
  })

  it('answers not-reported with a null model when no reply names one', async () => {
    script({ pass1: [unnamed(reviewJson([CRITICAL_DIVIDE]))], read1: [unnamed(VERDICTS)], read2: [unnamed(STANDS)] })
    const payload = await readPayload(await full(DIVIDE_BODY))
    expect(payload).toMatchObject({ success: true, model: null, modelCheck: 'not-reported' })
  })

  // Mutation: a pass 2 reply that names a model must not stand in for the pass 1 reply that named none.
  it('never shows another call\'s served model in place of the review reply that named none', async () => {
    script({ pass1: [unnamed(reviewJson([CRITICAL_DIVIDE]))], read1: [reply(VERDICTS)], read2: [reply(STANDS)] })
    const payload = await readPayload(await full(DIVIDE_BODY))
    expect(payload).toMatchObject({ success: true, model: null, modelCheck: 'not-reported' })
  })

  it('answers a failed provider call with a null model and not-reported, and sends no model choice', async () => {
    fetchStub.mockResolvedValueOnce(new Response('down', { status: 500 }))
    const res = await full(DIVIDE_BODY)
    const payload = await readPayload(res)
    expect(res.status).toBe(502)
    expect(payload).toMatchObject({ success: false, model: null, newestModel: null, modelCheck: 'not-reported' })
  })

  it('asks the public model list once per function instance, with the app User-Agent, and only the provider sees the review', async () => {
    twoPasses([CRITICAL_DIVIDE], [keep(1, 2, 'return a / b')])
    await full(DIVIDE_BODY)
    twoPasses([CRITICAL_DIVIDE], [keep(1, 2, 'return a / b')])
    await full(DIVIDE_BODY)
    expect(listStub).toHaveBeenCalledTimes(1)
    expect(listStub.mock.calls[0][0]).toBe(MODEL_LIST_URL)
    expect(listStub.mock.calls[0][1].headers).toMatchObject({ 'User-Agent': 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)' })
    expect(fetchStub.mock.calls.every(([url]) => url === 'https://openrouter.ai/api/v1/chat/completions')).toBe(true)
  })
})
