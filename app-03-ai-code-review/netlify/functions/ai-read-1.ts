import { serve } from '../shared/serve'

/** Request 2 of a review: read 1 of pass 2. It runs at the same time as read 2, in its own invocation with its own time budget. */
export default serve('read-1')

export const config = {
  path: '/api/ai/read-1',
}
