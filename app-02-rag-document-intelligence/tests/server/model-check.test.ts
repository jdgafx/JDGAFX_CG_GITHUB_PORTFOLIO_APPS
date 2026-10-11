import { describe, it, expect, vi } from 'vitest'
import { ALIAS, chatBody, installProviderStub, jsonReply, request, runOf, setList, SERVED, stubProvider, VALID } from './helpers'

installProviderStub()

const NEWER = 'anthropic/claude-haiku-6.0'
const ANSWER = '{"answer":"1987.","source_chunk_indices":[3],"confidence":0.9}'

/** A fresh copy of the function, so the newest model read by earlier tests is not kept. */
async function freshHandler() {
  vi.resetModules()
  return (await import('../../netlify/functions/ai')).default
}

const listOf = (slug: string) => ({ data: [{ id: ALIAS, alias_target: { name: 'Anthropic: Claude Haiku', slug } }] })

describe('ai function: which model answered', () => {
  it('marks a served model that is not the newest, logs it, and still answers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setList(listOf(NEWER))
    stubProvider(() => jsonReply(chatBody(ANSWER)))
    const run = await runOf(await (await freshHandler())(request(VALID)))
    expect(run.result.answer).toBe('1987.')
    expect(run.servedModel).toBe(SERVED)
    expect(run.newestModel).toBe(NEWER)
    expect(run.modelCheck).toBe('mismatch')
    expect(warn).toHaveBeenCalledWith(`model mismatch: served ${SERVED}, newest ${NEWER}, requested ${ALIAS}`)
  })

  it('reports unchecked when the list does not name the alias, and logs nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setList({ data: [{ id: 'other/model', alias_target: { slug: NEWER } }] })
    stubProvider(() => jsonReply(chatBody(ANSWER)))
    const run = await runOf(await (await freshHandler())(request(VALID)))
    expect(run.servedModel).toBe(SERVED)
    expect(run.newestModel).toBeNull()
    expect(run.modelCheck).toBe('unchecked')
    expect(warn).not.toHaveBeenCalled()
  })

  it('reports not-reported when the reply names no model, and never puts the requested alias in its place', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubProvider(() => jsonReply(chatBody(ANSWER, { model: null })))
    const run = await runOf(await (await freshHandler())(request(VALID)))
    expect(run.result.answer).toBe('1987.')
    expect(run.servedModel).toBeNull()
    expect(run.modelCheck).toBe('not-reported')
    expect(run.trace[2]?.detail).toBe('Response from a model the provider did not name.')
    expect(warn).not.toHaveBeenCalled()
  })

  it('does not borrow the model of a first call that was cut off when the retry names none', async () => {
    stubProvider(
      () => jsonReply(chatBody('{"answer":"The Harbor', { finish: 'length' })),
      () => jsonReply(chatBody(ANSWER, { model: null })),
    )
    const run = await runOf(await (await freshHandler())(request(VALID)))
    expect(run.trace.map(step => step.name)).toContain('Retry model call')
    expect(run.result.answer).toBe('1987.')
    expect(run.servedModel).toBeNull()
    expect(run.modelCheck).toBe('not-reported')
  })

  it('shows the reply-producing call with the worst check across its calls, naming the mismatching call', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setList(listOf(NEWER))
    stubProvider(
      () => jsonReply(chatBody('{"answer":"The Harbor', { finish: 'length' })),
      () => jsonReply(chatBody(ANSWER, { model: NEWER })),
    )
    const run = await runOf(await (await freshHandler())(request(VALID)))
    expect(run.servedModel).toBe(NEWER)
    expect(run.modelCheck).toBe('mismatch')
    expect(run.mismatchedModel).toBe(SERVED)
    expect(warn).toHaveBeenCalledWith(`model mismatch: served ${SERVED}, newest ${NEWER}, requested ${ALIAS}`)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('takes not-reported over unchecked when the calls disagree', async () => {
    setList({ data: [{ id: 'other/model', alias_target: { slug: NEWER } }] })
    stubProvider(
      () => jsonReply(chatBody('{"answer":"The Harbor', { finish: 'length' })),
      () => jsonReply(chatBody(ANSWER, { model: null })),
    )
    const run = await runOf(await (await freshHandler())(request(VALID)))
    expect(run.servedModel).toBeNull()
    expect(run.modelCheck).toBe('not-reported')
    expect(run.mismatchedModel).toBeNull()
  })

  it('prices a reply only by the model it names, never by the alias', async () => {
    setList({ data: [{ id: ALIAS, pricing: { prompt: '0.000001', completion: '0.000005' } }] })
    stubProvider(() => jsonReply(chatBody(ANSWER, { model: null, cost: false })))
    const run = await runOf(await (await freshHandler())(request(VALID)))
    expect(run.usage.cost).toBeNull()
    expect(run.usage.cost_source).toBeNull()
  })
})
