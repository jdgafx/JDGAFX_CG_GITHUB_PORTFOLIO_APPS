import type { Source } from '../types'

export const SOURCES_HEADING = '### Sources'
const NO_SOURCES_LINE = 'No sources were retrieved. This report rests on model memory and is unverified.'

/** Link text must not break the markdown link that wraps it. */
function linkText(title: string): string {
  return title.replace(/\[/g, '(').replace(/\]/g, ')')
}

/** One numbered list line. The list number equals the source's [n]. */
function sourceLine(source: Source): string {
  const where = source.note ? `${source.site}, ${source.note}` : source.site
  return `${source.n}. [${linkText(source.title)}](${source.url}) - ${where}`
}

/** The numbered list of sources, or the line saying there are none. */
export function sourcesList(sources: Source[]): string {
  return (sources.length > 0 ? sources.map(sourceLine) : [NO_SOURCES_LINE]).join('\n')
}

/** The Sources section of a report, built from the retrieved list and never from model text. */
export function sourcesMarkdown(sources: Source[]): string {
  return `${SOURCES_HEADING}\n\n${sourcesList(sources)}`
}

/** True when a report already ends with its Sources section. */
export function hasSourcesSection(text: string): boolean {
  return text.split('\n').some(line => line.trim() === SOURCES_HEADING)
}

/** The final report with its Sources section appended. */
export function withSources(content: string, sources: Source[]): string {
  return `${content.trimEnd()}\n\n${sourcesMarkdown(sources)}\n`
}
