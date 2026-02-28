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
    if (!text.trim()) {
      throw new Error('The text file appears to be empty.')
    }
    return { text, pages: 1 }
  }

  let arrayBuffer: ArrayBuffer
  try {
    arrayBuffer = await file.arrayBuffer()
  } catch {
    throw new Error('Failed to read the file. It may be corrupted or too large for your browser.')
  }

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) })
  let pdf: Awaited<typeof loadingTask.promise>
  try {
    pdf = await loadingTask.promise
  } catch {
    throw new Error('Failed to parse PDF. The file may be corrupted, password-protected, or not a valid PDF.')
  }

  const numPages = pdf.numPages
  if (numPages === 0) {
    throw new Error('This PDF has no pages.')
  }

  let fullText = ''

  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      const pageText = textContent.items
        .filter((item): item is TextItem => 'str' in item)
        .map((item: TextItem) => item.str)
        .join(' ')
      fullText += `--- Page ${i} ---\n${pageText}\n\n`
    } catch {
      // If a single page fails, skip it rather than crashing the whole extraction
      fullText += `--- Page ${i} ---\n[Could not extract text from this page]\n\n`
    }
  }

  const trimmed = fullText.trim()
  if (!trimmed || trimmed.replace(/--- Page \d+ ---/g, '').trim().length === 0) {
    throw new Error('No readable text found in this PDF. It may be a scanned document or contain only images.')
  }

  return { text: trimmed, pages: numPages }
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

    start = Math.max(start + Math.floor(maxChars / 2), end - overlap)
  }

  return chunks
}
