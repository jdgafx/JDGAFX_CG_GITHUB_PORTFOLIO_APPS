import { createRunHandler } from '../shared/handler'

/** Request 1 of an analysis: split, extract and reduce, ending with the key points. Request 2 is /api/synthesize. */
export default createRunHandler({ phase: 'extract' })

export const config = {
  path: '/api/run',
}
