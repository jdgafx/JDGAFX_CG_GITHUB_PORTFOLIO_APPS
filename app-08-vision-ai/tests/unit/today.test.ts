import { describe, expect, it } from 'vitest'
import { buildMessages, checkBody } from '../../netlify/shared/request'
import { todayLine, withToday } from '../../netlify/shared/today'

const PNG = 'aGVsbG8='

function messagesFor(body: Record<string, unknown>) {
  const checked = checkBody({ image: PNG, mediaType: 'image/png', ...body })
  if (!checked.ok) throw new Error(checked.message)
  return buildMessages(checked.value)
}

const MODES: Array<[string, Record<string, unknown>]> = [
  ['describe', { mode: 'describe' }],
  ['analyze', { mode: 'analyze' }],
  ['qa', { mode: 'qa', question: 'How many years ago was this taken?' }],
  ['extract', { mode: 'extract' }],
  ['region', { mode: 'region', question: 'What is this?', region: { sourceWidth: 100, sourceHeight: 80, x: 1, y: 2, width: 30, height: 20 } }],
  ['compare', { mode: 'compare', image2: PNG, mediaType2: 'image/png' }],
]

describe("today's date in the prompt", () => {
  it('is the date on the given clock, in UTC', () => {
    expect(todayLine(new Date('2026-10-13T08:30:00Z'))).toBe("Today's date is 2026-10-13.")
    expect(todayLine(new Date('2026-12-31T23:59:59Z'))).toBe("Today's date is 2026-12-31.")
  })

  it.each(MODES)('ends the %s system prompt, and only the system prompt', (_name, body) => {
    const plain = messagesFor(body)
    const dated = withToday(plain, new Date('2026-10-13T08:30:00Z'))
    expect(dated).toHaveLength(plain.length)
    for (const [i, message] of dated.entries()) {
      if (message.role === 'system') {
        expect(message.content).toMatch(/ Today's date is 2026-10-13\.$/)
        expect(message.content.startsWith(plain[i].content as string)).toBe(true)
      } else {
        expect(message).toEqual(plain[i])
      }
    }
  })
})
