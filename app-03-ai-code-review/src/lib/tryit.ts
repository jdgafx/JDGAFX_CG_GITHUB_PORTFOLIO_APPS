import { GITHUB_SUGGESTIONS } from '../constants'
import { fetchGitHubFile, languageForPath, parseGitHubRef, readContentsReply, type GitHubFile, type GitHubRef, type Parsed } from './github'

/** The file Try it reviews: clsx's src/index.js at a release tag, a 43-line file whose comments the second pass can check against the file alone. Fetched live from GitHub. */
export const EXAMPLE_LINK = GITHUB_SUGGESTIONS[2].link

export interface Example {
  file: GitHubFile
  language: string
}

/** The git blob SHA of some bytes, the value the contents API reports as `sha`. */
async function blobSha(bytes: Uint8Array): Promise<string> {
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`)
  const whole = new Uint8Array(head.length + bytes.length)
  whole.set(head)
  whole.set(bytes, head.length)
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1', whole))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The same public file straight from raw.githubusercontent.com, which has no 60-an-hour anonymous quota. Used only when the
 * contents API refused (an address that has spent its quota, such as a shared runner's). It goes through the same checks as the
 * API's reply. Null when it cannot be had either.
 */
async function fetchRawFile(ref: GitHubRef, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<Parsed<GitHubFile> | null> {
  if (ref.ref === null) return null
  const path = ref.path.split('/').map(encodeURIComponent).join('/')
  try {
    const response = await fetchImpl(`https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${encodeURIComponent(ref.ref)}/${path}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) })
    if (!response.ok) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return readContentsReply(
      { type: 'file', size: bytes.length, encoding: 'base64', content: btoa(binary), sha: await blobSha(bytes), html_url: `https://github.com/${ref.owner}/${ref.repo}/blob/${ref.ref}/${ref.path}` },
      ref,
    )
  } catch {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return null
  }
}

/** Fetches the example file from GitHub. Never rejects except on abort: a failure is a message for the visitor. */
export async function loadExample(signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<Parsed<Example>> {
  const ref = parseGitHubRef(EXAMPLE_LINK)
  if (!ref.ok) return ref
  const viaApi = await fetchGitHubFile(ref.value, signal, fetchImpl ? { fetchImpl } : undefined)
  const loaded = viaApi.ok ? viaApi : ((await fetchRawFile(ref.value, signal, fetchImpl)) ?? viaApi)
  if (!loaded.ok) return loaded
  return { ok: true, value: { file: loaded.value, language: languageForPath(loaded.value.path) ?? 'typescript' } }
}
