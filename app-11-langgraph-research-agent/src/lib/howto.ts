import { SAMPLE_QUESTIONS } from './constants'

export const HOWTO_WHAT = 'Ask a factual question and get an answer cited from Wikipedia, checked by a critic.'

/** Each quoted label is the exact text of a control on the page; a test reads the components to keep them equal. */
export const HOWTO_STEPS: readonly string[] = [
  'Type a question under "Your question", or open "Examples" and pick one.',
  'Press "Start research". It takes under a minute.',
  'Read the answer. The sources below it, numbered to match the [1] marks, link to the Wikipedia pages it used.',
  'Press "Rewind here and edit" under the plan or a critic step in the run trace, change what it did, and re-run from there to compare.',
]

/** The question "Try it" runs: two pages and a sum, so the critic has something to check. It is one of the Examples. */
export const TRY_IT = SAMPLE_QUESTIONS[2]

export const HOWTO_HINT = 'Asks the Eiffel Tower question on live Wikipedia. Under a minute.'
