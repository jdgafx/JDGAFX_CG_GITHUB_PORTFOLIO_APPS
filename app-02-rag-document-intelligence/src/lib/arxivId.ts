/**
 * An arXiv identifier, new style ("1706.03762", "2101.00001v2") or old style
 * ("hep-th/9901001"). Only this shape is ever put in a URL.
 */
export const ARXIV_ID = /^(?:\d{4}\.\d{4,5}|[a-z]+(?:-[a-z]+)*(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/

const ARXIV_LINK = /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/(.+?)(?:\.pdf)?\/?$/i

/**
 * Reads an identifier from what a person types or pastes: the bare ID, "arXiv:<id>",
 * or an arxiv.org abs or pdf link. Returns null when no valid ID is found.
 */
export function parseArxivId(input: string): string | null {
  let text = input.trim().replace(/[?#].*$/, '')
  const link = ARXIV_LINK.exec(text)
  if (link?.[1]) text = link[1]
  text = text.replace(/^arxiv:\s*/i, '')
  return ARXIV_ID.test(text) ? text : null
}

/** The paper's abstract page, shown as the document's source link. */
export function arxivAbsUrl(id: string): string {
  return `https://arxiv.org/abs/${id}`
}

/** The PDF URL for a validated ID. The host is a literal, so the ID is the only input. Throws on anything else. */
export function arxivPdfUrl(id: string): string {
  if (!ARXIV_ID.test(id)) throw new Error('Not an arXiv ID.')
  return `https://arxiv.org/pdf/${id}`
}
