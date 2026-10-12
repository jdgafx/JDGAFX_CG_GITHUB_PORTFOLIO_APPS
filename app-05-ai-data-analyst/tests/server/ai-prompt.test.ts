import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/ai'
import { modelListReply, routeFetch } from '../fixtures/openRouterList'

// The system prompt is sent to the provider, so these tests read it from the outgoing request.
// A literal `"countColumn": "rows"` in the template makes the model set a total on every plan.

const ORIGIN = 'http://localhost:5173'
const KEY = 'test-only-placeholder'
const HEADERS = ['date', 'product', 'revenue', 'units', 'region']
const PLAN = {
  chartType: 'bar',
  groupBy: 'product',
  aggregate: { field: 'revenue', fn: 'sum' },
  title: 'Total revenue by product',
  explanation: 'Adds up revenue for each product.',
  notice: null,
}
const PLACEHOLDER = '"countColumn": "<a column name from the dataset, or rows, or null>",'

let savedKey: string | undefined
let clientCounter = 0

beforeEach(() => {
  savedKey = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = KEY
})

afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = savedKey
  vi.unstubAllGlobals()
})

function modelReply(content: string): Response {
  return new Response(JSON.stringify({ model: 'anthropic/claude-haiku-5.5', choices: [{ message: { content }, finish_reason: 'stop' }], usage: {} }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Runs one request and returns the system message the provider received. */
async function systemPromptFor(body: Record<string, unknown>): Promise<string> {
  clientCounter += 1
  const mock = vi.fn(async () => modelReply(JSON.stringify(PLAN)))
  vi.stubGlobal('fetch', routeFetch(mock, async () => modelListReply(null)))
  const request = new Request('https://app.example/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': `prompt-client-${clientCounter}` },
    body: JSON.stringify(body),
  })
  const response = await handler(request)
  expect(response.status).toBe(200)
  const call = mock.mock.calls[0] as unknown as [string, { body: string }]
  const sent = JSON.parse(call[1].body) as { messages: Array<{ role: string; content: string }> }
  const system = sent.messages.find((message) => message.role === 'system')
  if (!system) throw new Error('the provider request had no system message')
  return system.content
}

describe('the query-plan prompt', () => {
  it('asks for the count column as a placeholder, never as a literal value', async () => {
    const system = await systemPromptFor({ question: 'Which product has the highest total revenue?', headers: HEADERS, sampleRows: [], rowCount: 50 })
    expect(system).toContain(PLACEHOLDER)
    expect(system).not.toMatch(/"countColumn":\s*"rows"/)
  })

  it('tells the model to name the column on a question that counts a group, and to invent no filter for a noun the data lacks', async () => {
    const system = await systemPromptFor({ question: 'How many regions had earthquakes?', headers: HEADERS, sampleRows: [], rowCount: 50 })
    expect(system).toContain('such as "how many regions had earthquakes?" (the region column)')
    expect(system).toContain('list that noun in "missing", and never invent a "filter" for it.')
  })

  it('asks the model whether the question is about the data, true whenever it lists what the data lacks', async () => {
    const system = await systemPromptFor({ question: 'asdf qwerty', headers: HEADERS, sampleRows: [], rowCount: 50 })
    expect(system).toContain('"aboutData": true | false,')
    expect(system).toContain('"aboutData" is false only when the question has nothing to do with this dataset')
    expect(system).toContain('Whenever "missing" is not empty, "aboutData" is true.')
  })

  it("ends with today's date from the server clock, for a first question and a follow-up", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-12T09:30:00Z'))
      const first = await systemPromptFor({ question: 'How many earthquakes this year?', headers: HEADERS, sampleRows: [], rowCount: 50 })
      vi.setSystemTime(new Date('2027-01-03T23:59:00Z'))
      const followUp = await systemPromptFor({
        question: 'Show only the top three',
        headers: HEADERS,
        sampleRows: [],
        rowCount: 50,
        previous: { question: 'Which product has the highest total revenue?', plan: PLAN },
      })
      expect(first.endsWith("Today's date is 2026-10-12.")).toBe(true)
      expect(followUp.endsWith("Today's date is 2027-01-03.")).toBe(true)
      expect(followUp).not.toContain('2026-10-12')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the placeholder in a follow-up prompt too', async () => {
    const system = await systemPromptFor({
      question: 'Show only the top three',
      headers: HEADERS,
      sampleRows: [],
      rowCount: 50,
      previous: { question: 'Which product has the highest total revenue?', plan: PLAN },
    })
    expect(system).toContain(PLACEHOLDER)
    expect(system).not.toMatch(/"countColumn":\s*"rows"/)
  })

  it('lists the count column among the parts a follow-up keeps, so a total survives "only Alaska"', async () => {
    const system = await systemPromptFor({
      question: 'Only Alaska',
      headers: HEADERS,
      sampleRows: [],
      rowCount: 50,
      previous: { question: 'In total, how many earthquakes had magnitude 4.5 or greater?', plan: { ...PLAN, countColumn: 'rows' } },
    })
    expect(system).toContain('limit, countColumn and chartType.')
    expect(system).toContain('A total stays a total ("countColumn" "rows") when the follow-up only adds a row condition, such as "only Alaska".')
  })
})
