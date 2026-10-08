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
  { value: 'css', label: 'CSS' },
  { value: 'html', label: 'HTML' },
  { value: 'sql', label: 'SQL' },
]

/** The label carries the meaning; the badge tone only reinforces it. */
export const SEVERITY_CONFIG: Record<Severity, { label: string; badge: string }> = {
  critical: { label: 'Critical', badge: 'ds-badge--danger' },
  warning: { label: 'Warning', badge: 'ds-badge--warning' },
  info: { label: 'Info', badge: 'ds-badge--accent' },
}

export const SEVERITIES: Severity[] = ['critical', 'warning', 'info']

export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

export const SEVERITY_HINT: Record<Severity, string> = {
  critical: 'Security holes, crashes and data loss risks',
  warning: 'Likely bugs, performance problems and code smells',
  info: 'Style, best practice and refactoring notes',
}

const FILE_EXTENSIONS: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  rust: 'rs',
  cpp: 'cpp',
  java: 'java',
  go: 'go',
}

export function getFileExt(lang: string): string {
  return FILE_EXTENSIONS[lang] ?? lang
}

/** Deliberately flawed snippet so the demo has something to find on the first click. */
export const SAMPLE_CODE = `// User service - sample snippet for CodeLens AI
const users = []

function addUser(name, email, password) {
  var id = users.length + 1
  users.push({ id: id, name: name, email: email, password: password })
  return id
}

function findUser(email) {
  for (var i = 0; i <= users.length; i++) {
    if (users[i].email == email) {
      return users[i]
    }
  }
}

async function loadProfile(id) {
  const res = await fetch('https://api.example.com/users/' + id)
  const data = await res.json()
  return data
}

function renderProfile(user) {
  const el = document.getElementById('profile')
  el.innerHTML = '<h2>' + user.name + '</h2><p>' + user.email + '</p>'
}

function exportAll() {
  let out = ''
  users.forEach(function (u) {
    out = out + JSON.stringify(u) + '\\n'
  })
  return out
}

module.exports = { addUser, findUser, loadProfile, renderProfile, exportAll }
`

export const SAMPLE_LANGUAGE = 'javascript'
