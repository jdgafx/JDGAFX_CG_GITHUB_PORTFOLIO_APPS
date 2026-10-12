import type { ReviewComment } from '../../src/types'
import type { Doc } from '../../netlify/shared/anchor'
import type { Candidate, CheckedDrop } from '../../netlify/shared/review'
import { buildComments, settleFirst, settleSecond, type Located, type RawVerdict } from '../../netlify/shared/verify'

/** What the server and the browser do between them with two reads: settle each read against the code, then build the list. */
export function assemble(
  candidates: Candidate[],
  checkedDrops: CheckedDrop[],
  reads: readonly [Map<number, RawVerdict> | null, Map<number, RawVerdict> | null],
  doc: Doc,
  locate: (line: number) => Located,
  inPullRequest = false,
): ReviewComment[] {
  return buildComments(candidates, checkedDrops, settleFirst(candidates, reads[0], doc), settleSecond(candidates, reads[1], doc), locate, inPullRequest)
}
