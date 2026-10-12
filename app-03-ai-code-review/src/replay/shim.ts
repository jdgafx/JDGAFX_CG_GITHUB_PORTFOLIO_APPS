// A fetch that answers the app's own /api/* calls from a recording, at the recorded times, while a replay is active.
// The app keeps calling fetch exactly as it does live, so its real client code renders the recorded replies.
// Nothing is sent to the network for an /api/* call while the shim is installed; a call the recording cannot answer
// ends the replay (onDiverge) and fails like a lost connection. The original fetch is put back as soon as the replay ends.

import type { Exchange, Recording } from './recording'

export interface ShimOptions {
  /** Where fetch lives: globalThis in the browser. */
  target: { fetch: typeof fetch }
  /** The page's origin; only same-origin /api/* calls are answered. */
  origin: string
  /** 1 plays at the recorded pace; 2 plays twice as fast. */
  speed: number
  /** True when the request the client really made is the one that was recorded. Defaults to an exact match of the bodies. */
  requestMatches?: (recorded: string | null, actual: string | null, path: string) => boolean
  /** The recording could not answer a call, or did not finish: the replay has ended and nothing was shown as real. */
  onDiverge?: (reason: string) => void
  /** Every recorded reply was delivered in full and the original fetch is back. */
  onDone?: () => void
}

export interface ReplayShim {
  readonly active: boolean
  /** Ends the replay now: pending replies are dropped, the original fetch is put back. Safe to call twice. */
  stop: () => void
}

// After the recorded span, the client gets this long to make its last call before the replay is called diverged.
const GRACE_MS = 2_000

function abortError(): DOMException {
  return new DOMException('The replay was stopped.', 'AbortError')
}

async function requestBody(input: Parameters<typeof fetch>[0], init: RequestInit | undefined): Promise<string | null> {
  if (typeof init?.body === 'string') return init.body
  if (init?.body != null || typeof input === 'string' || input instanceof URL) return null
  try {
    return await input.clone().text()
  } catch {
    return null
  }
}

interface Event {
  at: number
  run: () => void
}

export function installReplayShim(recording: Recording, opts: ShimOptions): ReplayShim {
  const { target, origin } = opts
  const original = target.fetch
  const speed = opts.speed > 0 ? opts.speed : 1
  const matches = opts.requestMatches ?? ((recorded, actual) => recorded === actual)
  const start = Date.now()
  const exchanges = [...recording.exchanges].sort((a, b) => a.t_start - b.t_start)
  const used = new Set<Exchange>()
  const cancels = new Set<() => void>()
  const timeline: Event[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let delivered = 0
  let active = true

  function stop(): void {
    if (!active) return
    active = false
    if (timer !== null) clearTimeout(timer)
    timer = null
    timeline.length = 0
    if (target.fetch === shim) target.fetch = original
    for (const cancel of cancels) cancel()
    cancels.clear()
  }

  function diverge(reason: string): void {
    if (!active) return
    stop()
    opts.onDiverge?.(reason)
  }

  // One timer at a time, events in time order, so a reply's chunks and its end can never arrive out of order.
  function pump(): void {
    timer = null
    while (active && timeline.length > 0) {
      const next = timeline[0]
      if (!next) break
      const wait = next.at - Date.now()
      if (wait > 0) {
        timer = setTimeout(pump, wait)
        return
      }
      timeline.shift()!.run()
    }
  }

  function enqueue(events: Event[]): void {
    timeline.push(...events)
    timeline.sort((a, b) => a.at - b.at)
    if (timer !== null) clearTimeout(timer)
    pump()
  }

  function deliver(ex: Exchange, signal: AbortSignal | undefined): Promise<Response> {
    return new Promise((resolve, reject) => {
      const encoder = new TextEncoder()
      let stream: ReadableStreamDefaultController<Uint8Array> | null = null
      let closed = false
      const body = new ReadableStream<Uint8Array>({ start: c => (stream = c) })
      const cancel = () => {
        if (!closed) {
          closed = true
          stream?.error(abortError())
        }
        reject(abortError())
      }
      cancels.add(cancel)
      signal?.addEventListener('abort', () => stop(), { once: true })
      const at = (ms: number) => start + ms / speed
      enqueue([
        { at: at(ex.t_headers), run: () => resolve(new Response(body, { status: ex.status, headers: ex.headers })) },
        ...ex.chunks.map(chunk => ({ at: at(chunk.t), run: () => stream?.enqueue(encoder.encode(chunk.text)) })),
        {
          at: at(ex.t_end),
          run: () => {
            closed = true
            stream?.close()
            cancels.delete(cancel)
            delivered += 1
            if (delivered === exchanges.length) {
              stop()
              opts.onDone?.()
            }
          },
        },
      ])
    })
  }

  const shim: typeof fetch = async (input, init) => {
    let url: URL
    try {
      url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, origin)
    } catch {
      return original(input, init)
    }
    if (!active || url.origin !== origin || !url.pathname.startsWith('/api/')) return original(input, init)
    const method = (init?.method ?? (typeof input === 'string' || input instanceof URL ? 'GET' : input.method)).toUpperCase()
    const path = url.pathname + url.search
    const signal = init?.signal ?? (typeof input === 'string' || input instanceof URL ? undefined : input.signal)
    if (signal?.aborted) {
      stop()
      throw abortError()
    }
    const actual = await requestBody(input, init)
    const ex = exchanges.find(e => !used.has(e) && e.method === method && e.path === path)
    if (!active) throw abortError()
    if (!ex) {
      diverge(`The recording has no answer for ${method} ${path}.`)
      throw new TypeError('Failed to fetch')
    }
    if (!matches(ex.request_body, actual, path)) {
      diverge(`The request for ${method} ${path} is not the one that was recorded.`)
      throw new TypeError('Failed to fetch')
    }
    used.add(ex)
    return deliver(ex, signal)
  }

  target.fetch = shim
  const span = Math.max(...exchanges.map(e => e.t_end))
  const watchdog = setTimeout(() => diverge('The replay did not finish.'), span / speed + GRACE_MS)
  cancels.add(() => clearTimeout(watchdog))

  return {
    get active() {
      return active
    },
    stop,
  }
}
