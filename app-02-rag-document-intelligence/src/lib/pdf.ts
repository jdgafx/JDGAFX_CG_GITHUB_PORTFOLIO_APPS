import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { pageMarkerPattern } from './chunk'
import { TimeoutError, withTimeout } from './timeout'

// Bundled with the app rather than pulled from a CDN, so the page keeps working
// offline and needs no third-party script origin in the CSP.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/** Longest wait for the PDF reader to open a file, or to read one page. */
const READ_TIMEOUT_MS = 30_000

const TOO_SLOW_MESSAGE = 'Reading this PDF took too long. Check your connection and try again.'

interface ExtractResult {
  text: string
  pages: number
}

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    const timeout = window.setTimeout(() => {
      reader.abort()
      reject(new Error('The browser could not finish reading this text file. Please try the upload again.'))
    }, 15_000)
    reader.onload = () => {
      window.clearTimeout(timeout)
      resolve(typeof reader.result === 'string' ? reader.result : '')
    }
    reader.onerror = () => {
      window.clearTimeout(timeout)
      reject(new Error('Failed to read the text file. It may be corrupted or unavailable to the browser.'))
    }
    reader.onabort = () => {
      window.clearTimeout(timeout)
      reject(new Error('The text-file read was cancelled. Please try the upload again.'))
    }
    reader.readAsText(file)
  })
}

export async function extractText(file: File): Promise<ExtractResult> {
  if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
    const text = await readTextFile(file)
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
    // The reader's worker script is fetched on first use, so a stalled network can hang here.
    pdf = await withTimeout(loadingTask.promise, READ_TIMEOUT_MS, TOO_SLOW_MESSAGE)
  } catch (err) {
    void loadingTask.destroy()
    // A TimeoutError already carries a sentence safe to show.
    throw err instanceof TimeoutError
      ? err
      : new Error('Failed to parse PDF. The file may be corrupted, password-protected, or not a valid PDF.')
  }

  const numPages = pdf.numPages
  if (numPages === 0) {
    throw new Error('This PDF has no pages.')
  }

  let fullText = ''

  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await withTimeout(pdf.getPage(i), READ_TIMEOUT_MS, TOO_SLOW_MESSAGE)
      const textContent = await withTimeout(page.getTextContent(), READ_TIMEOUT_MS, TOO_SLOW_MESSAGE)
      const pageText = textContent.items.map(item => ('str' in item ? item.str : '')).join(' ')
      fullText += `--- Page ${i} ---\n${pageText}\n\n`
    } catch (err) {
      // A page that never answers means the reader is stuck, so that ends the read.
      if (err instanceof TimeoutError) {
        void pdf.destroy()
        throw err
      }
      // If a single page fails, skip it rather than crashing the whole extraction
      fullText += `--- Page ${i} ---\n[Could not extract text from this page]\n\n`
    }
  }

  const trimmed = fullText.trim()
  if (!trimmed || trimmed.replace(pageMarkerPattern(), '').trim().length === 0) {
    throw new Error('No readable text found in this PDF. It may be a scanned document or contain only images.')
  }

  return { text: trimmed, pages: numPages }
}
