/**
 * Phrases that describe a triage decision or a review as still to come. The draft is only written once
 * the outcome is final, so a draft that says this contradicts the decision the rules or a maintainer made.
 * The patterns are narrow on purpose: "approved by a maintainer" must pass.
 */
const PENDING_CLAIMS: readonly RegExp[] = [
  /\b(?:requires?|required|needs?|needed|pending|awaiting|awaits?|subject\s+to)\s+(?:[\w-]+\s+){0,2}?(?:approval|review|triage|authori[sz]ation)\b/i,
  /\b(?:approval|review|triage|authori[sz]ation)\s+(?:[\w-]+\s+){0,3}?(?:is|are|was|will\s+be|must\s+be)?\s*(?:still\s+)?(?:required|needed|pending|outstanding|awaited)\b/i,
  /\b(?:will|shall|would|to)\s+follow\s+up\b[^.!?\n]{0,80}\b(?:approv|review|triage)/i,
  /\bfollow\s+up\s+once\b/i,
  /\bonce\b[^.!?\n]{0,40}\b(?:approval|review|triage)\b[^.!?\n]{0,20}\b(?:complete|completed|done|finished|granted)\b/i,
  /\bbefore\s+(?:it|this|the\s+issue)\s+can\s+be\s+(?:triaged|processed|labell?ed|prioriti[sz]ed)\b/i,
]

/** Negated wording such as "no further review is needed" is a clean statement, so it is removed before the check. */
const NEGATED =
  /\b(?:no|nothing|never|not|without)\s+(?:[\w-]+\s+){0,3}?(?:(?:requires?|needs?)\s+(?:[\w-]+\s+){0,2}?)?(?:approval|review|triage|authori[sz]ation)\b[^.!?\n]{0,30}/gi

/** True when the draft says an approval, review or triage step is still pending. */
export function claimsPendingApproval(text: string): boolean {
  const cleaned = text.replace(NEGATED, ' ')
  return PENDING_CLAIMS.some((pattern) => pattern.test(cleaned))
}

/**
 * Work a draft cannot honestly claim: nothing has been fixed, merged, released or closed, and the draft
 * is not posted anywhere. An issue that asks the assistant to say so is the usual way such a claim arrives.
 */
const UNEARNED_CLAIMS: readonly RegExp[] = [
  /\b(?:we|i)(?:'ve|\s+have|\s+had)?\s+(?:already\s+|just\s+)?(?:fixed|merged|released|deployed|shipped|closed|resolved)\b/i,
  /\b(?:has|have)\s+(?:already\s+|now\s+)?been\s+(?:fixed|merged|released|deployed|shipped|closed|resolved)\b/i,
  /\bfixed\s+in\s+(?:v?\d|the\s+(?:latest|next)\b)/i,
]

export function claimsUnearnedWork(text: string): boolean {
  return UNEARNED_CLAIMS.some((pattern) => pattern.test(text))
}

/** True when the draft links anywhere but the issue's own repository on GitHub. */
export function hasForeignLink(text: string, repo: string): boolean {
  const links = text.match(/(?:https?:\/\/|www\.)[^\s)>\]]+/gi) ?? []
  const own = `https://github.com/${repo}`.toLowerCase()
  return links.some((link) => {
    // A full stop or comma that ends the sentence is not part of the address.
    const lower = link.toLowerCase().replace(/[.,;:!?'"]+$/, '')
    return !(lower === own || lower.startsWith(`${own}/`))
  })
}

/** Why a draft was replaced, or null when it may stay. */
export function draftProblem(text: string, repo: string): string | null {
  if (claimsPendingApproval(text)) return 'said a decision or review was still pending'
  if (claimsUnearnedWork(text)) return 'claimed work that has not been done'
  if (hasForeignLink(text, repo)) return 'linked outside the issue repository'
  return null
}
