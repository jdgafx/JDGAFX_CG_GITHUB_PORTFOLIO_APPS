// Replies that are never an answer: a safety or moderation model's label.

// The model's served name is checked too: a safety or moderation model is never an answer.
export function unsuitableModel(model: string): boolean {
  return /(content[- ]?safety|moderation|classifier|guard|toxicity|safety[- ]?model)/i.test(model)
}

// The shape a safety classifier returns, which is never a conversational answer.
export function labelShaped(text: string): boolean {
  return /^(user\s+)?safety\s*:\s*(safe|unsafe)\b/i.test(text.trim().replace(/\s+/g, ' '))
}

// Characters held back before the first text goes out, so a label can be refused before anyone hears it.
export const GATE_CHARS = 24
