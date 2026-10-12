const MAX_NAME_CHARS = 214
const NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/

/**
 * A package name as the app writes it: lower case, an optional @scope/, no leading ~ or - (npm refuses them). The one
 * rule for both sides, so the browser never sends a name the function refuses, and a name differing only in case
 * cannot slip past the duplicate check.
 */
export function isPackageName(name: unknown): name is string {
  return typeof name === 'string' && name.length <= MAX_NAME_CHARS && NAME.test(name)
}
