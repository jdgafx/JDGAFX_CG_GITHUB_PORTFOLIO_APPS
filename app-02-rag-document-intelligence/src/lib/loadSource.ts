import { fetchArxivFile } from './arxiv'
import { arxivAbsUrl } from './arxivId'
import { buildDocument } from './document'
import { extractText } from './pdf'
import { fetchArticle } from './wikipedia'
import type { DocumentState } from '../types'

/** Where a document comes from: a chosen file, a Wikipedia article title, or an arXiv ID. */
export type SourceRequest =
  | { kind: 'file'; file: File }
  | { kind: 'wikipedia'; title: string }
  | { kind: 'arxiv'; id: string }

/** The status line shown while a source loads. */
export function describeRequest(request: SourceRequest): string {
  switch (request.kind) {
    case 'file':
      return `Reading ${request.file.name}. Long PDFs can take a few seconds.`
    case 'wikipedia':
      return `Fetching "${request.title}" from Wikipedia.`
    case 'arxiv':
      return `Fetching arXiv:${request.id}, then reading the PDF in your browser.`
  }
}

/** Loads one source and returns it ready to ask about. Wikipedia text is read in sections, PDFs by page. */
export async function loadSource(request: SourceRequest, signal: AbortSignal): Promise<DocumentState> {
  if (request.kind === 'wikipedia') {
    const article = await fetchArticle(request.title, signal)
    const label = article.truncated ? `Wikipedia, first ${article.sectionTitles.length} sections` : 'Wikipedia'
    return buildDocument({
      title: article.title,
      source: { label, url: article.url },
      text: article.text,
      unit: 'section',
      pages: article.sectionTitles.length,
      sectionTitles: article.sectionTitles,
    })
  }

  if (request.kind === 'arxiv') {
    const file = await fetchArxivFile(request.id, signal)
    const { text, pages } = await extractText(file)
    return buildDocument({
      title: `arXiv:${request.id}`,
      source: { label: 'arXiv', url: arxivAbsUrl(request.id) },
      text,
      unit: 'page',
      pages,
    })
  }

  const { text, pages } = await extractText(request.file)
  return buildDocument({ title: request.file.name, source: { label: 'Your file', url: null }, text, unit: 'page', pages })
}
