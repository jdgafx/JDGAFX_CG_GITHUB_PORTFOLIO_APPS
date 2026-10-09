/** Shown when the server keeps checkpoints in memory. The server sends the same wording. */
export const MEMORY_NOTE =
  'Checkpoints are kept in memory on this server because Netlify Blobs is not configured here. An approval can be lost on reload.'

/** Well-known, active public repositories, one click each. Any other public repo can be typed in. */
export const PRESET_REPOS: readonly string[] = [
  'react/react',
  'vitejs/vite',
  'microsoft/vscode',
  'denoland/deno',
  'langchain-ai/langgraphjs',
]
