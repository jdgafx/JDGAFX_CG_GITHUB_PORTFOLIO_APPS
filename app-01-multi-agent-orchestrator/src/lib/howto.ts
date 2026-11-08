import { EXAMPLES } from './agents'

export const HOWTO_WHAT = 'Four agents answer a question from live web pages, arXiv papers, Hacker News and Wikipedia, then audit every citation.'

/** Each quoted label is the exact text of a control on the page; a test reads the components to keep them equal. */
export const HOWTO_STEPS: readonly string[] = [
  'Type a topic under "Research topic", or pick one of the "Examples".',
  'Press "Start research". The report takes about 10 seconds.',
  'The audit then starts by itself and marks each cited sentence Supported, Partly supported or Not supported.',
  'Select a cited sentence to read the source text behind it.',
]

/** The question "Try it" runs. It is one of the Examples and reliably gets a report with cited sentences to audit. */
export const TRY_IT = EXAMPLES.find((example) => example.label === 'Gene editing') ?? EXAMPLES[0]!

export const HOWTO_HINT = 'Asks the CRISPR question on live sources, then audits it. About 15 seconds.'

/** The steps fold away once a run of the visitor's own has a result; a replay keeps them open, so the visitor reads them while it plays. */
export const stepsFolded = (phase: string, replaying: boolean): boolean => phase !== 'ready' && !replaying
