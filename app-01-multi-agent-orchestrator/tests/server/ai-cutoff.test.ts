import { describe, expect, it } from 'vitest'
import handler from '../../netlify/functions/ai'
import { SERVED, VALID_BODY, errorsOf, frames, installHarness, lengthReply, plan, providerCalls, reply, request } from './helpers'

installHarness()

const LENGTH_MESSAGE = (name: string) => `${name} ran out of reply length before it finished, so the run was stopped. Try again.`

describe('ai function: a reply cut off by length ends the run', () => {
  it.each([
    ['researcher', ['analyst', 'critic', 'synthesizer'], 'Researcher'],
    ['analyst', ['critic', 'synthesizer'], 'Analyst'],
    ['critic', ['synthesizer'], 'Critic'],
  ] as const)('stops after the %s, never passes its cut text on, and calls no later stage', async (cutRole, skipped, name) => {
    const replies = {
      researcher: reply('- SSE sends one-way events.', 0.0001, 120, 40),
      analyst: reply('- One-way push fits LLM output.', 0.00008, 150, 30),
      critic: reply('- Browser support is not discussed.', 0.00005, 180, 20),
      synthesizer: reply('SSE is one-way and simpler to proxy. [1]', 0.0004, 300, 90),
    }
    replies[cutRole] = lengthReply('- A complete-looking line [1].')
    const fetchMock = plan(replies)

    const events = await frames(await handler(request(VALID_BODY)))

    expect(errorsOf(events)).toEqual([LENGTH_MESSAGE(name)])
    // Both attempts were cut off; the cut text was never sent as a chunk or a completed stage.
    expect(events.filter(event => event.agent === cutRole).map(event => event.type)).toEqual(['agent_start', 'agent_error'])
    expect(events.filter(event => event.type === 'agent_skipped').map(event => event.agent)).toEqual(skipped)
    expect(events.at(-1)).toMatchObject({ type: 'session_complete', result: '' })
    const prior = ['researcher', 'analyst', 'critic'].indexOf(cutRole)
    expect(providerCalls(fetchMock)).toHaveLength(prior + 2)
    // No later stage was given the cut text.
    for (const call of providerCalls(fetchMock)) expect(String(call[1]?.body)).not.toContain('A complete-looking line')
  })

  it('writes no report when the synthesizer is cut off, even though its text parses', async () => {
    plan({
      researcher: reply('- SSE sends one-way events.', 0.0001, 120, 40),
      analyst: reply('- One-way push fits LLM output.', 0.00008, 150, 30),
      critic: reply('- Browser support is not discussed.', 0.00005, 180, 20),
      synthesizer: lengthReply('SSE is one-way [1]. WebSockets are'),
    })
    const events = await frames(await handler(request(VALID_BODY)))
    expect(errorsOf(events)).toEqual([LENGTH_MESSAGE('Synthesizer')])
    expect(events.some(event => event.type === 'agent_chunk' && event.agent === 'synthesizer')).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'session_complete', result: '', trace: expect.arrayContaining([expect.objectContaining({ name: 'Synthesizer', status: 'failed' })]) })
  })

  it('reports an empty reply that ended on length as a length error, not as "no text"', async () => {
    plan({
      researcher: lengthReply(''),
      analyst: reply('- B.', 0.1, 10, 10),
      critic: reply('- C.', 0.1, 10, 10),
      synthesizer: reply('D [1].', 0.1, 10, 10),
    })
    const events = await frames(await handler(request(VALID_BODY)))
    expect(errorsOf(events)).toEqual([LENGTH_MESSAGE('Researcher')])
  })

  it('uses a retry that finishes, even when the cut-off first attempt had more text', async () => {
    let attempt = 0
    plan({
      researcher: () => {
        attempt += 1
        return attempt === 1 ? lengthReply('- A much longer first attempt that was cut off before it ended, with many words in it.')() : reply('- Short.', 0.1, 10, 10)()
      },
      analyst: reply('- B.', 0.1, 10, 10),
      critic: reply('- C.', 0.1, 10, 10),
      synthesizer: reply('D [1].', 0.1, 10, 10),
    })
    const events = await frames(await handler(request(VALID_BODY)))
    expect(errorsOf(events)).toEqual([])
    expect(events.find(event => event.type === 'agent_chunk' && event.agent === 'researcher')).toMatchObject({ content: '- Short.' })
  })
})


describe('ai function: only stop and end_turn are a finished reply', () => {
  const finishedWith = (text: string, finish: string) => () =>
    new Response(
      [{ model: SERVED, choices: [{ delta: { content: text } }] }, { model: SERVED, choices: [{ delta: {}, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0.0002 } }]
        .map(value => `data: ${JSON.stringify(value)}\n\n`)
        .join('') + 'data: [DONE]\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )

  it.each(['content_filter', 'tool_calls', 'some_new_reason'])('ends the run on finish_reason %s and uses none of its text', async finish => {
    const fetchMock = plan({
      researcher: reply('- SSE sends one-way events.', 0.0001, 120, 40),
      analyst: finishedWith('- Looks complete but was stopped.', finish),
      critic: reply('- C.', 0.1, 10, 10),
      synthesizer: reply('D [1].', 0.1, 10, 10),
    })
    const events = await frames(await handler(request(VALID_BODY)))
    expect(errorsOf(events)).toEqual(['Analyst stopped before it finished, so the run was stopped. Try again.'])
    expect(events.some(event => event.type === 'agent_chunk' && event.agent === 'analyst')).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'session_complete', result: '' })
    expect(providerCalls(fetchMock).length).toBeGreaterThanOrEqual(3)
  })

  it('accepts end_turn as finished', async () => {
    plan({
      researcher: finishedWith('- SSE sends one-way events.', 'end_turn'),
      analyst: reply('- B.', 0.1, 10, 10),
      critic: reply('- C.', 0.1, 10, 10),
      synthesizer: reply('D [1].', 0.1, 10, 10),
    })
    expect(errorsOf(await frames(await handler(request(VALID_BODY))))).toEqual([])
  })
})

describe('ai function: a failed stage carries what it was billed', () => {
  it('sends the billed usage of a cut-off stage on its error, and counts it in the run totals', async () => {
    plan({
      researcher: lengthReply('- A complete-looking line [1].'),
      analyst: reply('- B.', 0.1, 10, 10),
      critic: reply('- C.', 0.1, 10, 10),
      synthesizer: reply('D [1].', 0.1, 10, 10),
    })
    const events = await frames(await handler(request(VALID_BODY)))
    const error = events.find(event => event.type === 'agent_error')
    // Both attempts were billed: 2 x (10 in, 4000 out, $0.001).
    expect(error).toMatchObject({ agent: 'researcher', usage: { prompt_tokens: 20, completion_tokens: 8000, total_tokens: 8020 } })
    expect(events.at(-1)).toMatchObject({ type: 'session_complete', usage: { prompt_tokens: 20, completion_tokens: 8000, total_tokens: 8020 } })
    expect(((events.at(-1)?.usage ?? {}) as { cost: number }).cost).toBeCloseTo(0.002, 6)
  })
})
