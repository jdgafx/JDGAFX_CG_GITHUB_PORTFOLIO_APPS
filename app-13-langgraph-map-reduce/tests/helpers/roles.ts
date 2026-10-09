import { CHECK, EXTRACT, SYNTH } from '../../netlify/shared/models'

/**
 * Every role calls the same model, so a scripted provider tells the roles apart by the output cap each
 * one sends (the models test pins that the three caps differ).
 */
export type Role = 'extract' | 'check' | 'synthesize'

const CAPS: Record<Role, number> = { extract: EXTRACT.maxTokens, check: CHECK.maxTokens, synthesize: SYNTH.maxTokens }

/** Works on a ChatRequest (maxTokens) and on a provider body (max_tokens). */
export function roleOf(request: { maxTokens: number } | { max_tokens: number }): Role {
  const cap = 'maxTokens' in request ? request.maxTokens : request.max_tokens
  const role = (Object.keys(CAPS) as Role[]).find((r) => CAPS[r] === cap)
  if (!role) throw new Error(`No role sends max tokens ${cap}`)
  return role
}

export const isExtract = (request: { maxTokens: number }): boolean => roleOf(request) === 'extract'
export const isCheck = (request: { maxTokens: number }): boolean => roleOf(request) === 'check'
