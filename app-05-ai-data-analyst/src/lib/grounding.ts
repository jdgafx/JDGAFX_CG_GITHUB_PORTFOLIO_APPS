import type { Vocabulary } from '../types'
import type { QuestionNouns } from './questionNouns'
import { labelFor } from './vocabulary'

/**
 * What the page says when the model reports that a new question has nothing to do with the dataset (`aboutData: false` in
 * its plan; "asdf qwerty", "tell me a joke"). Whether a question is about the data is a question of meaning, so the model
 * decides it from the column names and sample rows, and the browser carries the decision out (`planAndRun`). The browser
 * holds no list of words for it: a list refuses real questions the list did not foresee ("how hot was it?" over a
 * temperature column). The message points at columns the data does have.
 */
export function unansweredMessage(names: QuestionNouns, vocab: Vocabulary): string {
  const headers = (names.columns ?? []).map((column) => column.header)
  const preferred = [vocab.defaultGroupBy, ...Object.keys(vocab.labels), ...headers].filter(
    (header): header is string => header !== undefined && headers.includes(header),
  )
  const examples = [...new Set(preferred)].slice(0, 3).map((header) => labelFor(vocab, header))
  const list = examples.length > 1 ? `${examples.slice(0, -1).join(', ')} or ${examples[examples.length - 1]}` : examples.join('')
  const hint = examples.length > 0 ? ` Try naming a column, such as ${list}.` : ''
  return `The data does not answer this question. Nothing in this dataset matches what was asked, so no number is shown.${hint}`
}
