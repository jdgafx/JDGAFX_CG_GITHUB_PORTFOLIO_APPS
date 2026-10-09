import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../src/lib/api'
import { MAX_HISTORY_MESSAGES, historyFor, markUnsent, tooLongMessage } from '../../src/lib/history'

function msg(id: string, role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, content, ...extra }
}

describe('historyFor', () => {
  it('sends answered turns in order, without ids or model names', () => {
    const log = [msg('u1', 'user', 'two plus two?'), msg('a1', 'assistant', 'Four.', { model: 'anthropic/claude-haiku-5.5' })]

    expect(historyFor(log)).toEqual([
      { role: 'user', content: 'two plus two?' },
      { role: 'assistant', content: 'Four.' },
    ])
  })

  it.each([
    ['a request that failed', 'Could not reach the server. Check your connection and try again.'],
    ['a request the user cancelled', 'You cancelled it.'],
    ['a message the server refused with 400', 'Keep messages under 5000 characters.'],
  ])('leaves out a question that got no answer: %s', (_label, reason) => {
    const log = [
      msg('u1', 'user', 'first'),
      msg('a1', 'assistant', 'one'),
      markUnsent([msg('u2', 'user', 'Tell me a joke about cats')], 'u2', reason)[0],
    ]

    expect(historyFor(log)).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'one' },
    ])
  })

  it('keeps only the newest 20 answered messages, counting past unsent ones', () => {
    const log: ChatMessage[] = []
    for (let i = 0; i < 15; i++) {
      log.push(msg(`u${i}`, 'user', `q${i}`), msg(`a${i}`, 'assistant', `r${i}`))
      log.push(msg(`x${i}`, 'user', `lost${i}`, { unsent: 'You cancelled it.' }))
    }

    const sent = historyFor(log)

    expect(sent).toHaveLength(MAX_HISTORY_MESSAGES)
    expect(sent[0]).toEqual({ role: 'user', content: 'q5' })
    expect(sent.at(-1)).toEqual({ role: 'assistant', content: 'r14' })
    expect(sent.some(message => message.content.startsWith('lost'))).toBe(false)
  })
})

describe('markUnsent', () => {
  it('marks only the named message and keeps the rest as they were', () => {
    const log = [msg('u1', 'user', 'a'), msg('u2', 'user', 'b')]

    const next = markUnsent(log, 'u2', 'You cancelled it.')

    expect(next[0]).toBe(log[0])
    expect(next[1]).toEqual({ id: 'u2', role: 'user', content: 'b', unsent: 'You cancelled it.' })
  })
})

describe('tooLongMessage', () => {
  it('accepts 2000 characters and refuses 2001, naming the count', () => {
    expect(tooLongMessage('x'.repeat(2000))).toBeNull()
    expect(tooLongMessage('x'.repeat(2001))).toBe('Keep messages under 2000 characters. This one has 2,001.')
  })

  it('does not count surrounding spaces', () => {
    expect(tooLongMessage(`  ${'x'.repeat(2000)}  `)).toBeNull()
  })
})
