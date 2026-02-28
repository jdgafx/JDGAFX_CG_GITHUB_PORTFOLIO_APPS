export type AnalysisMode = 'describe' | 'analyze' | 'qa' | 'extract'

export interface AnalyzeOptions {
  file: File
  mode: AnalysisMode
  question?: string
  onChunk: (text: string) => void
  onComplete: () => void
  onError: (error: Error) => void
}

interface Base64Result {
  data: string
  mediaType: string
}

function fileToBase64(file: File): Promise<Base64Result> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Unexpected FileReader result type'))
        return
      }
      const commaIndex = result.indexOf(',')
      if (commaIndex === -1) {
        reject(new Error('Malformed data URL'))
        return
      }
      const header = result.slice(0, commaIndex)
      const data = result.slice(commaIndex + 1)
      const mediaType = header.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg'
      resolve({ data, mediaType })
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

const MAX_FILE_SIZE = 4 * 1024 * 1024 // 4MB

export async function analyzeImage(opts: AnalyzeOptions): Promise<void> {
  const { file, mode, question, onChunk, onComplete, onError } = opts
  try {
    if (file.size > MAX_FILE_SIZE) {
      throw new Error('Image is too large. Please use an image under 4MB.')
    }

    const { data, mediaType } = await fileToBase64(file)

    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: data, mediaType, mode, question }),
    })

    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
    if (!res.body) throw new Error('No response body')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') continue
        let parsed: unknown
        try {
          parsed = JSON.parse(payload)
        } catch {
          continue
        }
        if (typeof parsed === 'object' && parsed !== null) {
          const obj = parsed as Record<string, unknown>
          if (typeof obj['text'] === 'string') onChunk(obj['text'])
          if (typeof obj['error'] === 'string') throw new Error(obj['error'])
        }
      }
    }

    onComplete()
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)))
  }
}
