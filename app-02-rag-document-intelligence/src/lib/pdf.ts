import * as pdfjsLib from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

export interface ExtractResult {
  text: string
  pages: number
}

export async function extractText(file: File): Promise<ExtractResult> {
  if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
    const text = await file.text()
    return { text, pages: 1 }
  }

  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) })
  const pdf = await loadingTask.promise
  const numPages = pdf.numPages
  let fullText = ''

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .filter((item): item is TextItem => 'str' in item)
      .map(item => item.str)
      .join(' ')
    fullText += `--- Page ${i} ---\n${pageText}\n\n`
  }

  return { text: fullText.trim(), pages: numPages }
}

export function chunkText(text: string, maxChars: number = 500): string[] {
  const overlap = 50
  const chunks: string[] = []
  let start = 0

  while (start < text.length) {
    let end = start + maxChars

    if (end < text.length) {
      const searchWindow = text.slice(end, Math.min(end + 120, text.length))
      const sentenceEnd = searchWindow.search(/[.!?\n]/)
      if (sentenceEnd !== -1) {
        end = end + sentenceEnd + 1
      }
    } else {
      end = text.length
    }

    const chunk = text.slice(start, end).trim()
    if (chunk.length > 20) {
      chunks.push(chunk)
    }

    start = Math.max(start + 1, end - overlap)
  }

  return chunks
}
