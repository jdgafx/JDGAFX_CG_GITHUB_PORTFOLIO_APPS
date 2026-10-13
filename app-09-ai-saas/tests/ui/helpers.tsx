import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Day, ExplainResponse, Release, Rows, Segment } from '../../shared/types'
import vite from './fixtures/npm-vite.json'
import webpack from './fixtures/npm-webpack.json'
import esbuild from './fixtures/npm-esbuild.json'
import releasesVite from './fixtures/releases-vite.json'
import releasesWebpack from './fixtures/releases-webpack.json'
import releasesEsbuild from './fixtures/releases-esbuild.json'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
// jsdom has no matchMedia; the shared result-focus hook asks it whether the screen is narrow (the test screen is not).
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({ matches: query.includes('min-width'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
}

export interface Mounted {
  container: HTMLElement
  root: Root
  unmount: () => void
}

const open: Mounted[] = []

export function mount(node: ReactElement): Mounted {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(node))
  const mounted: Mounted = {
    container,
    root,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
  open.push(mounted)
  return mounted
}

export function cleanup(): void {
  for (const m of open.splice(0)) m.unmount()
}

export async function click(el: Element | null): Promise<void> {
  if (!el) throw new Error('click: element not found')
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

export async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

export const byText = (root: ParentNode, selector: string, text: string): HTMLElement | null =>
  Array.from(root.querySelectorAll<HTMLElement>(selector)).find(el => el.textContent?.trim() === text) ?? null

/** Let queued promises settle inside act. */
export async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

interface NpmCapture {
  downloads: Array<{ day: string; downloads: number }>
}

const toRows = (c: NpmCapture): Rows => Object.fromEntries(c.downloads.map(d => [d.day, d.downloads]))

/** Real npm range captures from 2026-10-12 (judge5-npm-*.json). */
export const NPM_ROWS: Record<string, Rows> = { vite: toRows(vite), webpack: toRows(webpack), esbuild: toRows(esbuild) }
export const NPM_BODY: Record<string, unknown> = { vite, webpack, esbuild }
export const RELEASES: Record<string, Release[]> = {
  vite: releasesVite.releases,
  webpack: releasesWebpack.releases,
  esbuild: releasesEsbuild.releases,
}
export const RUN_DATE: Day = '2026-10-12'

/** Turns a raw OpenRouter capture (step0r6-response-*.json) into the function's ExplainResponse. */
export function explainFromCapture(capture: unknown): ExplainResponse {
  const c = capture as {
    model: string
    choices: Array<{ message: { content: string } }>
    usage: { prompt_tokens: number; completion_tokens: number; completion_tokens_details: { reasoning_tokens: number } }
  }
  const body = JSON.parse(c.choices[0]!.message.content) as { paragraph: Segment[] }
  return {
    ok: true,
    paragraph: body.paragraph,
    servedModel: c.model,
    usage: { prompt: c.usage.prompt_tokens, completion: c.usage.completion_tokens, reasoning: c.usage.completion_tokens_details.reasoning_tokens },
    modelMs: 12000,
  }
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}
