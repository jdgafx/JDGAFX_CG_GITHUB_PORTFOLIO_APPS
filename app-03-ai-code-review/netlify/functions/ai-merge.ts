import { serve } from '../shared/serve'

/** Joins the shards of pass 1 of a large file: it opens the records the shards signed, merges their comments and signs the hand-off the reads need. It calls no model. */
export default serve('merge')

export const config = {
  path: '/api/ai/merge',
}
