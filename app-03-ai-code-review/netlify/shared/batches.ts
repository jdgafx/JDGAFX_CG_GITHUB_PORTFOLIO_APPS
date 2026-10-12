/** The most comments one read request is given. The whole numbered file goes with every request; only the comments are split. */
export const READ_BATCH_SIZE = 4

/**
 * The most batches one review can make: pass 1 is asked for 15 comments at most and the checks pass up to 5 more, and 20
 * comments are 5 batches. The read functions' request ceiling is that many requests per review.
 */
export const MAX_BATCHES = 5

/** Splits the ids of the comments that passed the checks into batches of at most four, in order. None is lost or repeated. */
export function batchesOf(ids: readonly number[]): number[][] {
  const batches: number[][] = []
  for (let i = 0; i < ids.length; i += READ_BATCH_SIZE) batches.push(ids.slice(i, i + READ_BATCH_SIZE))
  return batches
}
