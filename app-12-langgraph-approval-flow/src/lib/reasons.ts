/** The rules write the duplicate reason as a sentence that starts like this; netlify/shared/triage.ts is the only writer. */
const DUPLICATE_REASON = /^It looks like a duplicate of #\d+/

/** The reasons without the duplicate one, which the proposed action and its quotes already show. */
export function reasonsWithoutDuplicate(reasons: readonly string[]): string[] {
  return reasons.filter((reason) => !DUPLICATE_REASON.test(reason))
}
