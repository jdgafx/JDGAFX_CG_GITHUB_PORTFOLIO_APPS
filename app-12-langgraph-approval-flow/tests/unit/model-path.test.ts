import { describe, expect, it, vi } from 'vitest'
import { MODEL } from '../../netlify/shared/models'
import { runChat, traceRow, type NodeDeps } from '../../netlify/shared/nodes'
import type { ChatFn, ChatResult } from '../../netlify/shared/openrouter'
import { NEWEST_HAIKU } from '../helpers/fake-chat'

const NOW = new Date('2026-10-11T12:00:00Z')
const PROMPT = { system: 'Judge the candidates.', user: 'Issue text' }

function deps(chat: ChatFn, newest?: Promise<string | null>): NodeDeps {
  return { chat, now: () => NOW, remainingMs: () => 25_000, newest }
}

function replying(reply: Partial<ChatResult>): ChatFn {
  return vi.fn(async () => ({ text: 'ok', finishReason: 'stop', usage: {}, ...reply }))
}

function callOf(chat: ChatFn, newest?: Promise<string | null>) {
  return runChat(deps(chat, newest), MODEL, 100, PROMPT, new AbortController().signal, 0)
}

describe('the served model in the trace', () => {
  it('is null when the reply names no model, never the requested alias', async () => {
    const call = await callOf(replying({ servedModel: undefined }), Promise.resolve(NEWEST_HAIKU))

    const row = traceRow('duplicates', Date.now(), 'ok', 'Judged.', call)

    expect(row).toMatchObject({ model: null, newestModel: NEWEST_HAIKU, modelCheck: 'not-reported' })
  })

  it('is the model the reply named, and a match when it is the newest', async () => {
    const call = await callOf(replying({ servedModel: NEWEST_HAIKU }), Promise.resolve(NEWEST_HAIKU))

    expect(traceRow('duplicates', Date.now(), 'ok', 'Judged.', call)).toMatchObject({ model: NEWEST_HAIKU, modelCheck: 'match' })
  })

  it('is unchecked when no newest model was read for the run', async () => {
    const call = await callOf(replying({ servedModel: NEWEST_HAIKU }))

    expect(traceRow('duplicates', Date.now(), 'ok', 'Judged.', call)).toMatchObject({ model: NEWEST_HAIKU, newestModel: null, modelCheck: 'unchecked' })
  })
})

describe('a reply from another model', () => {
  it('is a mismatch, is logged once, and the reply is kept: nothing is refused', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const call = await callOf(replying({ servedModel: 'anthropic/claude-haiku-5' }), Promise.resolve(NEWEST_HAIKU))

    expect(call.modelCheck).toBe('mismatch')
    expect(call.result.text).toBe('ok')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(`model mismatch: served anthropic/claude-haiku-5, newest ${NEWEST_HAIKU}, requested ${MODEL}`)
    warn.mockRestore()
  })

  it('is not logged when the reply came from the newest model', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await callOf(replying({ servedModel: NEWEST_HAIKU }), Promise.resolve(NEWEST_HAIKU))

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
