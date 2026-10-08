export type Frame = Record<string, unknown> | '[DONE]'

const ORIGIN = 'https://graphgate.test'

/** A JSON POST from one client address. Each test uses its own address, so the rate limit never trips. */
export function postJson(path: string, body: unknown, client: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': client },
    body: JSON.stringify(body),
  })
}

export function getFrom(path: string, client = 'client-get'): Request {
  return new Request(`${ORIGIN}${path}`, { method: 'GET', headers: { 'x-nf-client-connection-ip': client } })
}

/** Every frame of a server-sent body, in order. The [DONE] marker comes back as the string '[DONE]'. */
export function parseFrames(text: string): Frame[] {
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('data: '))
    .map((block): Frame => {
      const data = block.slice('data: '.length).trim()
      return data === '[DONE]' ? '[DONE]' : (JSON.parse(data) as Record<string, unknown>)
    })
}

export async function readFrames(response: Response): Promise<Frame[]> {
  return parseFrames(await response.text())
}

/** The frames that carry a type, in order, for quick checks on the sequence. */
export function typesOf(frames: Frame[]): string[] {
  return frames.map((frame) => (frame === '[DONE]' ? '[DONE]' : String(frame.type)))
}
