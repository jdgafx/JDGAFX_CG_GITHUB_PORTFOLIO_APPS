// Speech models emit a small set of stock phrases when handed silence or pure
// noise ("Thank you.", "you", "."). Sending those to the assistant produces a
// confusing reply to something the user never said, so they are dropped and
// reported as "no speech detected".
const SILENCE_ARTIFACTS = new Set([
  '',
  'you',
  'thank you',
  'thanks',
  'thank you very much',
  'thanks for watching',
  'thank you for watching',
  'bye',
  'okay',
  'ok',
  'uh',
  'um',
  'mm',
  'hmm',
])

export function isLikelySilence(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[.,!?…"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return SILENCE_ARTIFACTS.has(normalized)
}
