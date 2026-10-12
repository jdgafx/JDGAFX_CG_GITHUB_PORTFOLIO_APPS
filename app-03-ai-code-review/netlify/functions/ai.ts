import { serve } from '../shared/serve'

/** Request 1 of a review: pass 1 and the deterministic checks. */
export default serve('review')

export const config = {
  path: '/api/ai',
}
