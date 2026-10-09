import type { Verdict } from '../types'

export interface VerdictView {
  /** The full words, for the panel and the screen reader. */
  word: string
  /** The short words on the inline badge. */
  short: string
}

export const VERDICT_VIEW: Record<Verdict, VerdictView> = {
  supported: { word: 'Supported', short: 'Supported' },
  partly: { word: 'Partly supported', short: 'Partly' },
  unsupported: { word: 'Not supported', short: 'Not supported' },
  unchecked: { word: 'Not checked', short: 'Not checked' },
  checking: { word: 'Checking', short: 'Checking' },
}

/** The order the summary bar and legend use, best first. */
export const VERDICT_ORDER: Array<Exclude<Verdict, 'checking'>> = ['supported', 'partly', 'unsupported', 'unchecked']
