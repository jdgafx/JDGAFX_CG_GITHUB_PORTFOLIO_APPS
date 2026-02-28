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
    let errMessage = 'Transcription failed'
    try {
      const errData = await res.json() as { error?: string }
      if (errData.error) errMessage = errData.error
    } catch {
      // Response wasn't JSON, use generic message
    }
    throw new Error(errMessage)
  }

  const data = await res.json() as { text?: string }
  if (!data.text) {
    throw new Error('No transcription returned')
  }
  return data.text
}

export async function chat(message: string, history: Message[]): Promise<string> {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  })

  if (!res.ok) {
    let errMessage = 'AI request failed'
    try {
      const errData = await res.json() as { error?: string }
      if (errData.error) errMessage = errData.error
    } catch {
      // Response wasn't JSON, use generic message
    }
    throw new Error(errMessage)
  }

  const data = await res.json() as { response?: string }
  if (!data.response) {
    throw new Error('No response from AI')
  }
  return data.response
}
