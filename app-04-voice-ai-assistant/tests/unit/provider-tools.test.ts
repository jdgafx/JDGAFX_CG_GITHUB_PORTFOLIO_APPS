import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { replyText, runModelCall, type Turn } from '../../netlify/shared/provider'
import { createRecorder } from '../../netlify/shared/trace'
import { PLACEHOLDER, jsonResponse, sentRequest } from '../helpers'
import { callsTo, routeFetch, weatherRoutes } from '../tool-fixtures'

const TURNS: Turn[] = [
  { role: 'system', content: 'Be brief.' },
  { role: 'user', content: "What's the weather in Lisbon right now?" },
]
const OPTIONS = () => ({ maxTokens: 256, deadlineAt: Date.now() + 25_000 })
const OPENROUTER = 'openrouter.ai'

function toolCall(id: string, name: string, args: string) {
  return { id, type: 'function', function: { name, arguments: args } }
}

// The model's first reply: no text, one or more tool requests.
function asksFor(calls: unknown[], usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.00002 }) {
  return {
    model: 'anthropic/claude-haiku-5.5',
    choices: [{ message: { role: 'assistant', content: null, tool_calls: calls }, finish_reason: 'tool_calls' }],
    usage,
  }
}

function answers(content: string, usage = { prompt_tokens: 160, completion_tokens: 15, total_tokens: 175, cost: 0.00003 }) {
  return {
    model: 'anthropic/claude-haiku-5.5',
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage,
  }
}

// OpenRouter replies are taken in order; the weather and Wikipedia routes answer as recorded.
function withModel(replies: unknown[], extra: Array<[string, () => Response]> = weatherRoutes) {
  let next = 0
  return routeFetch([
    [OPENROUTER, () => jsonResponse(replies[Math.min(next++, replies.length - 1)])],
    ...extra,
  ])
}

describe('runModelCall with tools', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('runs the tool the model asked for, then asks again for the answer with tool_choice none', async () => {
    const fetchMock = withModel([
      asksFor([toolCall('call_1', 'weather', '{"place":"Lisbon"}')]),
      answers('It is 17.6 degrees and clear in Lisbon.'),
    ])
    const run = createRecorder()

    const outcome = await runModelCall(PLACEHOLDER, TURNS, OPTIONS(), run)

    if (!outcome.ok) throw new Error('expected a reply')
    expect(replyText(outcome.completion)).toBe('It is 17.6 degrees and clear in Lisbon.')
    expect(callsTo(fetchMock, OPENROUTER)).toHaveLength(2)

    const first = sentRequest(fetchMock, 0)
    expect(first).not.toHaveProperty('tool_choice')
    const second = sentRequest(fetchMock, 1 + callsTo(fetchMock, 'open-meteo').length)
    expect(second.tool_choice).toBe('none')
    expect(second.tools.map(tool => tool.function.name)).toEqual(['weather', 'wikipedia_summary'])
    expect(second.messages.slice(0, 2)).toEqual(TURNS)
    expect(second.messages[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [toolCall('call_1', 'weather', '{"place":"Lisbon"}')],
    })
    expect(second.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'call_1' })
    expect(second.messages[3].content).toContain('Now: 17.6 °C, clear sky.')
  })

  it('records model call, tool call and model answer, with the call and its source on the tool step', async () => {
    withModel([asksFor([toolCall('call_1', 'weather', '{"place":"Lisbon"}')]), answers('Clear and 17.6 degrees.')])
    const run = createRecorder()

    await runModelCall(PLACEHOLDER, TURNS, OPTIONS(), run)

    expect(run.steps.map(step => [step.name, step.status])).toEqual([
      ['model call', 'ok'],
      ['tool call', 'ok'],
      ['model answer', 'ok'],
    ])
    expect(run.steps[0]).toMatchObject({ detail: 'anthropic/claude-haiku-5.5, asked for weather', tokens: 120 })
    expect(run.steps[1]).toMatchObject({
      detail: 'Lisbon, Lisbon District, Portugal: 17.6 °C, clear sky',
      call: 'weather("Lisbon")',
    })
    expect(run.steps[1].source).toContain('https://api.open-meteo.com/v1/forecast?latitude=38.72509')
    expect(run.steps[2]).toMatchObject({ detail: 'anthropic/claude-haiku-5.5', tokens: 175 })
  })

  it('adds the usage of both model calls', async () => {
    withModel([asksFor([toolCall('call_1', 'weather', '{"place":"Lisbon"}')]), answers('Clear.')])

    const outcome = await runModelCall(PLACEHOLDER, TURNS, OPTIONS(), createRecorder())

    if (!outcome.ok) throw new Error('expected a reply')
    expect(outcome.usage).toEqual({ prompt_tokens: 260, completion_tokens: 35, total_tokens: 295, cost: 0.00005 })
  })

  it('does not retry a tool request as if it were an empty reply', async () => {
    const fetchMock = withModel([asksFor([toolCall('call_1', 'weather', '{"place":"Lisbon"}')]), answers('Clear.')])

    await runModelCall(PLACEHOLDER, TURNS, OPTIONS(), createRecorder())

    expect(callsTo(fetchMock, OPENROUTER)).toHaveLength(2)
  })

  it('passes a failed tool to the model as plain text and still answers', async () => {
    const fetchMock = withModel(
      [asksFor([toolCall('call_1', 'weather', '{"place":"Lisbon"}')]), answers('The weather service did not answer.')],
      [
        ['geocoding-api', () => jsonResponse({ results: [{ name: 'Lisbon', latitude: 1, longitude: 2, country: 'Portugal' }] })],
        ['v1/forecast', () => new Response('down', { status: 500 })],
      ],
    )
    const run = createRecorder()

    const outcome = await runModelCall(PLACEHOLDER, TURNS, OPTIONS(), run)

    expect(outcome.ok).toBe(true)
    const toolMessage = sentRequest(fetchMock, callsTo(fetchMock, 'open-meteo').length + 1).messages.at(-1)
    expect(toolMessage?.content).toBe(
      'The weather service did not answer. No data is available, so tell the user that instead of guessing.',
    )
    expect(run.steps.map(step => [step.name, step.status])).toEqual([
      ['model call', 'ok'],
      ['tool call', 'failed'],
      ['model answer', 'ok'],
    ])
    expect(run.steps[1].source).toBeUndefined()
  })

  it('runs several tool calls from one round and answers each with its own tool message', async () => {
    const fetchMock = withModel(
      [
        asksFor([
          toolCall('call_a', 'weather', '{"place":"Lisbon"}'),
          toolCall('call_b', 'wikipedia_summary', '{"topic":"Ada Lovelace"}'),
        ]),
        answers('Both done.'),
      ],
      [
        ...weatherRoutes,
        [
          '/page/summary/Ada_Lovelace',
          () =>
            jsonResponse({
              title: 'Ada Lovelace',
              extract: 'An English mathematician.',
              content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Ada_Lovelace' } },
            }),
        ],
      ],
    )
    const run = createRecorder()

    await runModelCall(PLACEHOLDER, TURNS, OPTIONS(), run)

    const second = sentRequest(fetchMock, fetchMock.mock.calls.length - 1)
    expect(second.messages.slice(3).map(message => message.tool_call_id)).toEqual(['call_a', 'call_b'])
    expect(run.steps.filter(step => step.name === 'tool call').map(step => step.call)).toEqual([
      'weather("Lisbon")',
      'wikipedia_summary("Ada Lovelace")',
    ])
    expect(run.steps[0].detail).toBe('anthropic/claude-haiku-5.5, asked for weather and wikipedia_summary')
  })

  it('names a tool once in the model step when it was asked for twice', async () => {
    withModel([
      asksFor([toolCall('a', 'weather', '{"place":"Lisbon"}'), toolCall('b', 'weather', '{"place":"Lisbon, Portugal"}')]),
      answers('Done.'),
    ])
    const run = createRecorder()

    await runModelCall(PLACEHOLDER, TURNS, OPTIONS(), run)

    expect(run.steps[0].detail).toBe('anthropic/claude-haiku-5.5, asked for weather')
    expect(run.steps.filter(step => step.name === 'tool call')).toHaveLength(2)
  })

  it('runs at most three tool calls in a round', async () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map(id => toolCall(id, 'weather', '{"place":"Lisbon"}'))
    const fetchMock = withModel([asksFor(five), answers('Done.')])

    await runModelCall(PLACEHOLDER, TURNS, OPTIONS(), createRecorder())

    expect(callsTo(fetchMock, 'v1/forecast')).toHaveLength(3)
    const second = sentRequest(fetchMock, fetchMock.mock.calls.length - 1)
    expect(second.messages[2].tool_calls).toHaveLength(3)
    expect(second.messages.filter(message => message.role === 'tool')).toHaveLength(3)
  })

  it('does not start a second round when the answer call asks for tools again', async () => {
    const again = asksFor([toolCall('call_2', 'weather', '{"place":"Porto"}')])
    const fetchMock = withModel([asksFor([toolCall('call_1', 'weather', '{"place":"Lisbon"}')]), again])
    const run = createRecorder()

    const outcome = await runModelCall(PLACEHOLDER, TURNS, OPTIONS(), run)

    if (!outcome.ok) throw new Error('expected a completion')
    expect(replyText(outcome.completion)).toBe('')
    expect(callsTo(fetchMock, OPENROUTER)).toHaveLength(2)
    expect(callsTo(fetchMock, 'v1/forecast')).toHaveLength(1)
    expect(run.steps.filter(step => step.name === 'tool call')).toHaveLength(1)
  })

  it('treats a tool request with no usable entries as an empty reply and retries once', async () => {
    const fetchMock = withModel([asksFor([{ type: 'function' }]), answers('pong')])

    const outcome = await runModelCall(PLACEHOLDER, TURNS, OPTIONS(), createRecorder())

    if (!outcome.ok) throw new Error('expected a reply')
    expect(replyText(outcome.completion)).toBe('pong')
    expect(callsTo(fetchMock, OPENROUTER)).toHaveLength(2)
    expect(callsTo(fetchMock, 'open-meteo')).toHaveLength(0)
  })

  it('records a failed model answer when the second call is refused', async () => {
    let call = 0
    routeFetch([
      [OPENROUTER, () => (++call === 1 ? jsonResponse(asksFor([toolCall('c', 'weather', '{"place":"Lisbon"}')])) : new Response('no', { status: 402 }))],
      ...weatherRoutes,
    ])
    const run = createRecorder()

    const outcome = await runModelCall(PLACEHOLDER, TURNS, OPTIONS(), run)

    expect(outcome).toEqual({ ok: false, httpStatus: 502, message: 'The AI provider rejected the key or is out of credit.' })
    expect(run.steps.map(step => [step.name, step.status])).toEqual([
      ['model call', 'ok'],
      ['tool call', 'ok'],
      ['model answer', 'failed'],
    ])
  })
})
