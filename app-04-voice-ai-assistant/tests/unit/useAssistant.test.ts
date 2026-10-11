import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The real hook, rendered once on the server so its callbacks exist. The server renderer never
// applies state updates, so `busy` stays false, which is exactly what a second submit in the same
// tick sees: the render has not caught up with the first one.
const chat = vi.hoisted(() => vi.fn())
vi.mock('../../src/lib/chatStream', () => ({ chat }))
vi.mock('../../src/lib/replyVoice', () => ({ createReplyVoice: () => ({ push: () => undefined, finish: () => undefined, cancel: () => undefined, segmentEnd: () => undefined }) }))

import { useAssistant } from '../../src/hooks/useAssistant'

type Assistant = ReturnType<typeof useAssistant>

function mount(): { current: Assistant } {
  const seen = { current: undefined as unknown as Assistant }
  const Probe = () => {
    seen.current = useAssistant()
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return seen
}

const answer = { text: 'ok', model: null, modelCheck: 'unchecked', newestModel: null, checkedModel: null, usage: undefined, totalMs: 0 }

describe('useAssistant sendText', () => {
  afterEach(() => {
    chat.mockReset()
  })

  it('sends one request when two submits arrive in the same tick', async () => {
    chat.mockImplementation(() => new Promise(() => undefined))
    const { current } = mount()
    current.sendText('Who was Ada Lovelace?')
    current.sendText('Who was Ada Lovelace?')
    await Promise.resolve()
    expect(chat).toHaveBeenCalledTimes(1)
    expect(chat.mock.calls[0][1]).toEqual([])
  })

  it('accepts a new question once the first has been stopped', async () => {
    chat.mockImplementation(() => new Promise(() => undefined))
    const { current } = mount()
    current.sendText('first')
    current.stopRun()
    current.sendText('second')
    await Promise.resolve()
    expect(chat).toHaveBeenCalledTimes(2)
  })

  it('accepts a new question once the first has been answered', async () => {
    chat.mockResolvedValue(answer)
    const { current } = mount()
    current.sendText('first')
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 0))
    current.sendText('second')
    await Promise.resolve()
    expect(chat).toHaveBeenCalledTimes(2)
  })
})
