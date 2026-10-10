import { GITHUB_SUGGESTIONS } from '../constants'
import { fetchGitHubFile, languageForPath, parseGitHubRef, type GitHubFile, type Parsed } from './github'

/** The file Try it reviews: Redux's createStore.ts at a release tag, mid-size and quick to review. Fetched live from GitHub. */
export const EXAMPLE_LINK = GITHUB_SUGGESTIONS[2].link

export interface Example {
  file: GitHubFile
  language: string
}

/** Fetches the example file from GitHub. Never rejects except on abort: a failure is a message for the visitor. */
export async function loadExample(signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<Parsed<Example>> {
  const ref = parseGitHubRef(EXAMPLE_LINK)
  if (!ref.ok) return ref
  const loaded = await fetchGitHubFile(ref.value, signal, fetchImpl ? { fetchImpl } : undefined)
  if (!loaded.ok) return loaded
  return { ok: true, value: { file: loaded.value, language: languageForPath(loaded.value.path) ?? 'typescript' } }
}
