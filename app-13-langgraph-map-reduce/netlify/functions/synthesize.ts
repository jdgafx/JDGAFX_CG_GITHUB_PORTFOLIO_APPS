import { createSynthesizeHandler } from '../shared/handler'

/** Request 2 of an analysis: the summary and its review, from the key points request 1 made, in its own invocation with its own time budget. */
export default createSynthesizeHandler()

export const config = {
  path: '/api/synthesize',
}
