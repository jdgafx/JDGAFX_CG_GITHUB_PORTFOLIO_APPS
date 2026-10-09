import type { Severity } from './types'

/** Gutter rows, textarea rows and jump-to-line maths all key off this. Matches the line height in app.css. */
export const LINE_HEIGHT = 24

export const LANGUAGES = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust' },
  { value: 'go', label: 'Go' },
  { value: 'java', label: 'Java' },
  { value: 'cpp', label: 'C++' },
  { value: 'c', label: 'C' },
  { value: 'csharp', label: 'C#' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'php', label: 'PHP' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'swift', label: 'Swift' },
  { value: 'shell', label: 'Shell' },
  { value: 'css', label: 'CSS' },
  { value: 'html', label: 'HTML' },
  { value: 'sql', label: 'SQL' },
]

/** The label carries the meaning. The dot beside it is coloured in app.css. */
export const SEVERITY_CONFIG: Record<Severity, { label: string }> = {
  critical: { label: 'Critical' },
  warning: { label: 'Warning' },
  info: { label: 'Info' },
}

export const SEVERITIES: Severity[] = ['critical', 'warning', 'info']

export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

export const SEVERITY_HINT: Record<Severity, string> = {
  critical: 'Security holes, crashes and data loss risks',
  warning: 'Likely bugs, performance problems and code smells',
  info: 'Style, best practice and refactoring notes',
}

/** The stages of a run, in order. Names match the server's trace. */
export const PIPELINE_STAGES: ReadonlyArray<{ name: string; detail: string }> = [
  { name: 'Check request', detail: 'Applies the rate limit and checks the size of the code or diff.' },
  { name: 'Build prompt', detail: 'Numbers every line and sets the comment budget.' },
  { name: 'Pass 1: review', detail: 'The first model call writes the comments. Retried once if the connection drops.' },
  { name: 'Parse reply', detail: 'Reads the JSON review. Code fences and surrounding prose are tolerated.' },
  { name: 'Checks', detail: 'Drops comments that cite a bad line, quote code that is not there, or propose no change.' },
  { name: 'Pass 2: verify', detail: 'The second model call keeps, moves or drops each comment, quoting the code.' },
  { name: 'Re-validate', detail: 'Checks every verdict against the code before it is shown as checked.' },
]

const FILE_EXTENSIONS: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  rust: 'rs',
  cpp: 'cpp',
  java: 'java',
  go: 'go',
  csharp: 'cs',
  ruby: 'rb',
  kotlin: 'kt',
  shell: 'sh',
}

export function getFileExt(lang: string): string {
  return FILE_EXTENSIONS[lang] ?? lang
}

/**
 * Public files offered as one-click starts. Only the links are kept here: each file is fetched from GitHub when
 * chosen. They point at release tags, so the files stay the same size and the line numbers stay put.
 */
export const GITHUB_SUGGESTIONS: ReadonlyArray<{ link: string; blurb: string }> = [
  {
    link: 'https://github.com/psf/requests/blob/v2.32.3/src/requests/auth.py',
    blurb: 'HTTP Basic and Digest authentication in the Python requests library.',
  },
  {
    link: 'https://github.com/gorilla/mux/blob/v1.8.1/mux.go',
    blurb: 'The request router and URL matcher of a widely used Go web toolkit.',
  },
  {
    link: 'https://github.com/reduxjs/redux/blob/v5.0.1/src/createStore.ts',
    blurb: 'The store at the core of Redux, written in TypeScript.',
  },
]

/** Merged public pull requests offered as one-click starts. Each is fetched from GitHub when chosen. */
export const PR_SUGGESTIONS: ReadonlyArray<{ link: string; blurb: string }> = [
  {
    link: 'https://github.com/psf/requests/pull/6963',
    blurb: 'A security fix for credential handling in requests: two files, mostly Python.',
  },
  {
    link: 'https://github.com/gorilla/mux/pull/731',
    blurb: 'Adds a hook to override regexp compilation in the Go router: three files.',
  },
  {
    link: 'https://github.com/gorilla/mux/pull/691',
    blurb: 'A performance change that cuts allocations in the Go router: five files, a larger diff.',
  },
]
