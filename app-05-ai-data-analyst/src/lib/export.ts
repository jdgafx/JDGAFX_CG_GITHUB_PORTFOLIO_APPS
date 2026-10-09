import { measureWords } from './answer'
import { parseNumericCell } from './dataEngine'
import { labelFor, RAW_VOCABULARY } from './vocabulary'
import type { AnalysisResult } from '../types'

/** A spreadsheet runs a cell that starts with one of these as a formula, so it is written as text. */
const FORMULA_START = /^[=+@\t\r]/

function csvCell(text: string): string {
  const safe = FORMULA_START.test(text) || (text.startsWith('-') && parseNumericCell(text) === null) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** The current result as CSV: one row per group, the group in the first column, the measure in the second. */
export function resultToCsv(result: AnalysisResult): string {
  const vocab = result.vocab ?? RAW_VOCABULARY
  const plan = result.queryPlan
  const values = result.datasets[0]?.values ?? []
  const unit = plan.aggregate.fn === 'count' ? undefined : vocab.units[plan.aggregate.field]
  const measure = unit ? `${measureWords(plan, vocab)} (${unit})` : measureWords(plan, vocab)
  const lines = [[labelFor(vocab, plan.groupBy), measure].map(csvCell).join(',')]
  result.labels.forEach((label, index) => {
    lines.push([csvCell(label), String(Number((values[index] ?? 0).toFixed(6)))].join(','))
  })
  return `${lines.join('\r\n')}\r\n`
}

const MAX_SLUG = 80

/** A file name from a chart title: lower case words joined by hyphens. */
export function fileSlug(title: string): string {
  const full = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  // A long title is cut at a word, never in the middle of one.
  const slug = full.length > MAX_SLUG ? full.slice(0, MAX_SLUG).replace(/-[^-]*$/, '') : full
  return slug || 'datapilot-result'
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // The click starts the download synchronously; the address can go a moment later.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadCsv(result: AnalysisResult, title: string): void {
  saveBlob(new Blob([resultToCsv(result)], { type: 'text/csv;charset=utf-8' }), `${fileSlug(title)}.csv`)
}

const PNG_SCALE = 2
const PNG_PAD = 20
const STYLE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linejoin', 'stroke-linecap', 'stroke-dasharray',
  'opacity', 'font-family', 'font-size', 'font-weight', 'paint-order', 'text-anchor', 'dominant-baseline',
] as const

/** Copies the computed paint of each live node onto its clone, so the picture needs no stylesheet. */
function inlineStyles(live: Element, clone: Element): void {
  const style = getComputedStyle(live)
  const css = STYLE_PROPS.map((prop) => `${prop}:${style.getPropertyValue(prop)}`).join(';')
  clone.setAttribute('style', css)
  Array.from(live.children).forEach((child, index) => {
    const twin = clone.children[index]
    if (twin) inlineStyles(child, twin)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The chart could not be drawn to an image.'))
    image.src = src
  })
}

interface PngInfo {
  title: string
  subtitle: string
  filename: string
}

/**
 * The chart as a PNG at twice its size, on the page's surface colour, with the title above and the
 * data source below. The chart is the live SVG with its computed styles inlined, drawn through a canvas.
 */
export async function downloadChartPng(svg: SVGSVGElement, info: PngInfo): Promise<void> {
  const box = svg.getBoundingClientRect()
  const width = Math.round(box.width)
  const height = Math.round(box.height)
  const clone = svg.cloneNode(true) as SVGSVGElement
  inlineStyles(svg, clone)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.removeAttribute('style')
  const markup = new XMLSerializer().serializeToString(clone)
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`)

  const root = getComputedStyle(document.documentElement)
  const head = 56
  const foot = 36
  const canvas = document.createElement('canvas')
  canvas.width = (width + PNG_PAD * 2) * PNG_SCALE
  canvas.height = (height + head + foot) * PNG_SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot draw the chart to an image.')
  ctx.scale(PNG_SCALE, PNG_SCALE)
  ctx.fillStyle = root.getPropertyValue('--ds-surface').trim() || '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const font = root.getPropertyValue('--ds-font').trim() || 'sans-serif'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = root.getPropertyValue('--ds-text').trim() || '#000000'
  ctx.font = `650 18px ${font}`
  ctx.fillText(info.title, PNG_PAD, 30, width)
  ctx.fillStyle = root.getPropertyValue('--ds-text-muted').trim() || '#555555'
  ctx.font = `13px ${font}`
  ctx.fillText(info.subtitle, PNG_PAD, head - 8, width)
  ctx.drawImage(image, PNG_PAD, head, width, height)
  ctx.fillText('DataPilot, Christopher Gentile', PNG_PAD, head + height + 22, width)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The image could not be saved.')
  saveBlob(blob, info.filename)
}
