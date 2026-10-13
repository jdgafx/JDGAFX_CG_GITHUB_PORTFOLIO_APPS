import { useEffect, useState } from 'react'

/** One Wikipedia page as the page itself reads it on load: no model, no server function of this app. */
export interface PageLead {
  title: string
  description: string
  extract: string
  url: string
}

export type PageLeadsState =
  | { status: 'loading' }
  | { status: 'ready'; leads: PageLead[]; at: number }
  | { status: 'failed' }

const SITE = 'https://en.wikipedia.org'
const TIMEOUT_MS = 8_000

export function summaryUrl(title: string): string {
  return `${SITE}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`
}

/** Reads Wikipedia's page-summary reply. Null for anything that is not an ordinary page with text and an en.wikipedia.org link. */
export function readLead(value: unknown): PageLead | null {
  if (typeof value !== 'object' || value === null) return null
  const page = value as { type?: unknown; title?: unknown; description?: unknown; extract?: unknown; content_urls?: { desktop?: { page?: unknown } } }
  const url = page.content_urls?.desktop?.page
  if (page.type !== 'standard' || typeof page.title !== 'string' || typeof page.extract !== 'string' || page.extract.trim() === '') return null
  if (typeof url !== 'string' || !url.startsWith(`${SITE}/wiki/`)) return null
  return { title: page.title, description: typeof page.description === 'string' ? page.description : '', extract: page.extract.trim(), url }
}

async function fetchLead(title: string, signal: AbortSignal): Promise<PageLead> {
  const response = await fetch(summaryUrl(title), { signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) })
  if (!response.ok) throw new Error(`Wikipedia answered with status ${response.status}.`)
  const lead = readLead(await response.json())
  if (!lead) throw new Error('Wikipedia sent a page this app could not read.')
  return lead
}

/** On load, the lead of each page of the example question, straight from Wikipedia. Free live data; a model is never asked. */
export function usePageLeads(titles: readonly string[]): PageLeadsState {
  const [state, setState] = useState<PageLeadsState>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    void Promise.allSettled(titles.map((title) => fetchLead(title, controller.signal))).then((results) => {
      if (controller.signal.aborted) return
      const leads = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
      setState(leads.length > 0 ? { status: 'ready', leads, at: Date.now() } : { status: 'failed' })
    })
    return () => controller.abort()
  }, [titles])
  return state
}
