export interface DocumentState {
  title: string
  text: string
  chunks: string[]
  pages: number
  charCount: number
}

export interface AiResponse {
  answer: string
  source_chunk_indices: number[]
  confidence: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sourceChunks?: number[]
  confidence?: number
  timestamp: Date
  error?: boolean
}
