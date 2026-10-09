import type { Classification, IssueInput } from '../../src/types'

/**
 * Text aimed at the AI, not at a maintainer, is the plainest way to steer a triage. Two independent checks
 * look for it, and either one sends the issue to a maintainer. The model's reading is the broad check: it
 * understands synonyms and the difference between a request to the assistant and a report about a product's
 * own prompts. The patterns here are the narrow check: few, high precision, and not dependent on the model.
 * More patterns are not the answer, because each new one catches ordinary issues too.
 */

/** Direct address, an override of earlier guidance, or an instruction about the reply. */
const ADDRESS_PATTERNS: readonly RegExp[] = [
  // Direct address: "Assistant, ...", "To the AI reading this", "for the language model:", "Note to the bot".
  /(?:^|[.!?\n]\s*)(?:(?:hey|dear|note\s+to|attention)\s+(?:the\s+)?)?(?:ai|assistant|chatbot|llm|chatgpt|claude|language\s+model|triage\s*bot)\s*[,:]/i,
  /\b(?:to|for|note\s+to)\s+the\s+(?:ai|assistant|chatbot|llm|language\s+model|bot)\b(?:\s+(?:reading|that|who|processing)\b|\s*[,:])/i,
  /\byou\s+are\s+(?:now\s+)?(?:an?\s+)?(?:ai|assistant|language\s+model|llm|chatbot|triagebot)\b/i,
  /\byou\s+are\s+now\b/i,
  /\bas\s+an\s+ai\s*,/i,
  /\bpretend\s+(?:you\s+are|you're|to\s+be)\b/i,
  /\bact\s+as\s+(?:an?\s+)?(?:\w+\s+){0,2}(?:assistant|ai|maintainer|bot|model)\b/i,
  // Override: "ignore your instructions", "disregard all prior rules", "overlook the earlier guidance".
  /\b(?:ignore|disregard|overlook|forget|override)\s+(?:(?:all|any|the|your|these|those|my|every|and)\s+)*(?:previous|prior|above|earlier|system|your|all)\s+(?:instructions?|guidance|rules|prompts?|directives|guidelines)\b/i,
  /\b(?:ignore|disregard|overlook|forget)\s+(?:(?:all|any|the|your)\s+)*(?:instructions?|guidance|rules|prompts?|directives)\s+(?:above|earlier|before|you\s+(?:were|have\s+been)\s+given)\b/i,
  /\bforget\s+everything\s+you\s+(?:were|have\s+been)\s+(?:told|given)\b/i,
  /\b(?:new|updated)\s+instructions?\s*:/i,
  /\b(?:print|reveal|show|repeat)\s+(?:me\s+)?your\s+system\s+prompt\b|\bsystem\s+prompt\s*[:=]/i,
  // Steering the triage: "label this as critical", "mark it auto-triaged", "set confidence to 100%".
  /\b(?:mark|tag|classify|label|triage|categori[sz]e)\s+(?:this|it|the\s+issue)\s+as\s+(?:a\s+|an\s+)?(?:bug|feature|question|docs?|critical|urgent|high|low|duplicate|wontfix|resolved|auto|spam|invalid|security|p0)\b/i,
  /\b(?:mark|set)\s+(?:this|it)\s+(?:as\s+)?auto[- ]?triag|\bauto[- ]?triage\s+(?:this|it)\b/i,
  /\b(?:with|and|at|set|give|use|output)\s+(?:a\s+|full\s+)?confidence\s+(?:of\s+|to\s+|=\s*)?(?:1(?:\.0+)?|100\s*%)/i,
  /\bskip\s+the\s+(?:human|maintainer)\s+(?:review|approval)\b/i,
  // Steering the reply: "in your reply include a link", "output only the word LGTM as your reply".
  /\b(?:in|into|to)\s+your\s+(?:reply|response|answer|comment|draft)\b(?!\s+(?:headers?|body|code|status|time|object|payload|stream|handler))/i,
  /\bas\s+your\s+(?:reply|response|answer|comment)\b/i,
  /\b(?:reply|respond|answer)\s+(?:to\s+this\s+)?with\s+(?:a\s+link|the\s+(?:word|text|phrase|string)|exactly|only|just)\b/i,
]

function matchOf(text: string): string | null {
  for (const pattern of ADDRESS_PATTERNS) {
    const found = pattern.exec(text)
    if (found) return found[0].trim()
  }
  return null
}

const squash = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim()

/** The shortest quote the model may give as evidence. A word or two would match almost any issue. */
const MIN_EVIDENCE_CHARS = 8

/**
 * The model's quote, when it says the issue is aimed at the assistant and the quote really is in the issue
 * text (case and spacing aside). A flag with no matching quote does not count: the model may be wrong, or
 * may have been talked into the flag.
 */
export function verifiedEvidence(issue: IssueInput, classification: Classification): string | null {
  if (!classification.addressedToAssistant) return null
  const quote = squash(classification.assistantEvidence)
  if (quote.length < MIN_EVIDENCE_CHARS) return null
  return squash(`${issue.title}\n${issue.body}`).includes(quote) ? classification.assistantEvidence.trim() : null
}

/** What in the issue text is aimed at the assistant: the model's verified quote, else a pattern match, else null. */
export function assistantEvidence(issue: IssueInput, classification: Classification): string | null {
  return verifiedEvidence(issue, classification) ?? matchOf(`${issue.title}\n${issue.body}`)
}

/** True when a pattern alone finds text aimed at the assistant. */
export function matchesAssistantPattern(text: string): boolean {
  return matchOf(text) !== null
}
