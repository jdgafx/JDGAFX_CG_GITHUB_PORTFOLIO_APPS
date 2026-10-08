// Shared helpers for the test suite. Nothing here reaches a provider: every test
// replaces fetch with stubFetch before it calls a handler, and assertions check
// the stub was called with the request the test expects.
import { vi, type Mock } from 'vitest'

export const ORIGIN = 'http://localhost:5173'
export const PLACEHOLDER = 'test-only-placeholder'

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
export type FetchMock = Mock<FetchFn>

export function stubFetch(reply: FetchFn): FetchMock {
  const mock = vi.fn<FetchFn>(reply)
  vi.stubGlobal('fetch', mock)
  return mock
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

export function urlOf(mock: FetchMock, call = 0): string {
  return String(mock.mock.calls[call]?.[0])
}

export function headerOf(mock: FetchMock, call: number, name: string): string | null {
  return new Headers(mock.mock.calls[call]?.[1]?.headers).get(name)
}

// The OpenRouter request body as the tests care about it.
interface SentRequest {
  model: string
  max_tokens: number
  reasoning: { enabled: boolean }
  usage: { include: boolean }
  messages: Array<{ role: string; content: string }>
}

export function sentRequest(mock: FetchMock, call = 0): SentRequest {
  return JSON.parse(String(mock.mock.calls[call]?.[1]?.body)) as SentRequest
}

// The shape the functions return, as far as the tests read it.
interface ServerStep {
  name: string
  status: string
  ms: number
  detail: string
  tokens?: number
  cost?: number
}

interface ServerBody {
  error?: string
  result?: string
  model?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number }
  trace?: ServerStep[]
  totalMs?: number
}

export async function bodyOf(res: Response): Promise<ServerBody> {
  return (await res.json()) as ServerBody
}

let clientCounter = 0

// Every request gets its own client address, so the per-instance rate limit can
// never change a result (the limiter keys on this header).
function nextClientIp(): string {
  clientCounter += 1
  return `10.0.${Math.floor(clientCounter / 250)}.${(clientCounter % 250) + 1}`
}

interface RequestOptions {
  method?: string
  json?: unknown
  body?: RequestInit['body']
  origin?: string | null
  headers?: Record<string, string>
}

export function request(url: string, options: RequestOptions = {}): Request {
  const headers: Record<string, string> = { 'x-nf-client-connection-ip': nextClientIp(), ...options.headers }
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN
  let body = options.body
  if (options.json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(options.json)
  }
  return new Request(url, { method: options.method ?? 'POST', headers, body })
}

// Environment values a test changes. restoreEnv puts every one back in afterEach.
const savedEnv = new Map<string, string | undefined>()

export function setEnv(name: string, value: string): void {
  if (!savedEnv.has(name)) savedEnv.set(name, process.env[name])
  process.env[name] = value
}

export function restoreEnv(): void {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  savedEnv.clear()
}
