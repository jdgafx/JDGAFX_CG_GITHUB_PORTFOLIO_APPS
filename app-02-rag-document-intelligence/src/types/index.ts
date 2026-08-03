export interface DocumentState {
  title: string
  text: string
  chunks: string[]
  /** Page number each chunk starts on, parallel to `chunks`. */
  chunkPages: number[]
  pages: number
  charCount: number
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
