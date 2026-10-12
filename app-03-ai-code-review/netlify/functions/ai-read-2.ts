import { serve } from '../shared/serve'

/** Request 3 of a review: read 2 of pass 2, the adversarial read. */
export default serve('read-2')

export const config = {
  path: '/api/ai/read-2',
}
