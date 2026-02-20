export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export async function transcribe(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer()
  const uint8Array = new Uint8Array(arrayBuffer)
  let binary = ''
  for (let i = 0; i < uint8Array.byteLength; i++) {
    binary += String.fromCharCode(uint8Array[i])
  }
  const base64 = btoa(binary)

  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: base64, mimeType: blob.type }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Transcribe failed: ${err}`)
  }

  const data = await res.json() as { text: string }
  return data.text
}

export async function chat(message: string, history: Message[]): Promise<string> {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`AI failed: ${err}`)
  }

  const data = await res.json() as { response: string }
  return data.response
}
