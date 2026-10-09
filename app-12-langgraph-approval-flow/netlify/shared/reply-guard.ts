/**
 * Phrases that describe an approval or review as still needed. The reply is only written once the
 * outcome is final, so a draft that says this contradicts the decision a person or the policy made.
 * The patterns are narrow on purpose: "approved by a member of our team" must pass.
 */
const PENDING_CLAIMS: readonly RegExp[] = [
  /\b(?:requires?|required|needs?|needed|pending|awaiting|awaits?|subject\s+to)\s+(?:[\w-]+\s+){0,2}?(?:approval|review|authori[sz]ation)\b/i,
  /\b(?:approval|review|authori[sz]ation)\s+(?:[\w-]+\s+){0,3}?(?:is|are|was|will\s+be|must\s+be)?\s*(?:still\s+)?(?:required|needed|pending|outstanding|awaited)\b/i,
  /\b(?:will|shall|would|to)\s+follow\s+up\b[^.!?\n]{0,80}\b(?:approv|review)/i,
  /\bfollow\s+up\s+once\b/i,
  /\bonce\b[^.!?\n]{0,40}\b(?:approval|review)\b[^.!?\n]{0,20}\b(?:complete|completed|done|finished|granted)\b/i,
  /\bbefore\s+(?:it|this|the\s+refund)\s+can\s+be\s+(?:processed|issued|completed)\b/i,
]

/** Negated wording such as "no further approval is needed" is a clean statement, so it is removed before the check. */
const NEGATED =
  /\b(?:no|nothing|never|not|without)\s+(?:[\w-]+\s+){0,3}?(?:(?:requires?|needs?)\s+(?:[\w-]+\s+){0,2}?)?(?:approval|review|authori[sz]ation)\b[^.!?\n]{0,30}/gi

/** True when the email says an approval, review or follow-up is still pending. */
export function claimsPendingApproval(text: string): boolean {
  const cleaned = text.replace(NEGATED, ' ')
  return PENDING_CLAIMS.some((pattern) => pattern.test(cleaned))
}
