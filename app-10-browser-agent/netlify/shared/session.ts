import { readdir, readFile, rm, statfs } from 'node:fs/promises'
import chromium from '@sparticuz/chromium'
import { chromium as playwright, type Browser } from 'playwright-core'
import { ExecutionError, withTimeout } from './browser'

/** Longest the browser may take to start. The first start after a cold function unpacks Chromium into /tmp. */
export const LAUNCH_TIMEOUT_MS = 12_000
/** Longest a page open or a browser close may take. */
export const BROWSER_TIMEOUT_MS = 7_000
/** A warm container is retired when /tmp has less than this much room left. */
const MIN_TMP_FREE_MB = 200
/** A warm container is retired when the function and its browser hold more than this much memory (the limit is 1,024 MB). */
const MAX_RSS_MB = 850
/** The profile and artifact folders Playwright makes in /tmp for every browser it starts. */
const PLAYWRIGHT_TEMP = /^playwright[_-]/
/** The folders this process's browsers made. Only these are ever removed, so another program's folders in /tmp are never touched. */
const ownedDirs = new Set<string>()

export interface Launched {
  browser: Browser
  /** The path of the Chromium binary, which identifies this browser's processes. */
  executablePath: string
  /** The Chromium version the browser reports, such as 153.0.8010.0. */
  version: string
  /** Milliseconds spent unpacking the Chromium binary: large on a cold function, near zero when it is already in /tmp. */
  unpackMs: number
}

/** What a warm container holds after a run. Logged at the end of every run, and used to decide whether to retire the container. */
export interface Diagnostics {
  tmpFreeMb: number | null
  playwrightDirs: number
  chromiumProcesses: number
  /** Chromium processes outside this process's tree, such as an orphan handed to init. They are never ended, only counted. */
  strayProcesses: number
  chromiumRssMb: number
  functionRssMb: number
}

export interface Reaped {
  killed: number
  removedDirs: number
}

const mb = (bytes: number): number => Math.round(bytes / 1_048_576)

/** The parent id from the text of /proc/<pid>/stat. The command name sits in parentheses and may hold spaces, so it is skipped from its end. */
export function parentOf(stat: string): number | null {
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  const ppid = Number(fields[1])
  return Number.isInteger(ppid) ? ppid : null
}

/** The ids of every process in `processes` that descends from `root`, found by following parent ids. */
export function descendantsOf(root: number, processes: Array<{ pid: number; ppid: number }>): Set<number> {
  const found = new Set<number>()
  let grew = true
  while (grew) {
    grew = false
    for (const { pid, ppid } of processes) {
      if (!found.has(pid) && (ppid === root || found.has(ppid))) {
        found.add(pid)
        grew = true
      }
    }
  }
  return found
}

/** True when `root` is an ancestor of `pid`, found by walking parent ids upward from `pid`. */
async function descendsFrom(pid: number, root: number): Promise<boolean> {
  let current = pid
  for (let depth = 0; depth < 64; depth++) {
    const parent = parentOf(await readFile(`/proc/${current}/stat`, 'utf8').catch(() => ''))
    if (parent === null || parent <= 0) return false
    if (parent === root) return true
    current = parent
  }
  return false
}

/**
 * Every process whose command line names the Chromium binary, split in two: the ones this process started (its
 * children, their children and so on), with their resident memory in KB, and the pids of the ones outside that tree.
 * Only the first group is ever ended. The second is only counted, so a leftover browser still retires the container.
 */
export async function scanChromium(executablePath: string): Promise<{ ours: Array<{ pid: number; rssKb: number }>; outside: number[] }> {
  const entries = await readdir('/proc').catch(() => [] as string[])
  const pids = entries.map(Number).filter((pid) => Number.isInteger(pid) && pid !== process.pid)
  // The command line is the cheap test, so it runs first on every process. The ancestry check runs only on the few that match.
  const matching = (await Promise.all(pids.map(async (pid) => {
    const command = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')
    return command.includes(executablePath) ? pid : null
  }))).filter((pid): pid is number => pid !== null)
  const ours: Array<{ pid: number; rssKb: number }> = []
  const outside: number[] = []
  for (const pid of matching) {
    if (!(await descendsFrom(pid, process.pid))) {
      outside.push(pid)
      continue
    }
    const status = await readFile(`/proc/${pid}/status`, 'utf8').catch(() => '')
    ours.push({ pid, rssKb: Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) })
  }
  return { ours, outside }
}

/** The processes this process started that run the Chromium binary. A process outside this tree is never listed. */
export async function chromiumProcesses(executablePath: string): Promise<Array<{ pid: number; rssKb: number }>> {
  return (await scanChromium(executablePath)).ours
}

async function playwrightDirs(): Promise<string[]> {
  try {
    return (await readdir('/tmp')).filter((name) => PLAYWRIGHT_TEMP.test(name))
  } catch {
    return []
  }
}

/** Ends every process of this process's own tree that runs the Chromium binary and removes the folders this process's browsers made in /tmp. One request at a time runs in a container. */
export async function reapChromium(executablePath: string): Promise<Reaped> {
  let killed = 0
  for (const { pid } of await chromiumProcesses(executablePath)) {
    try {
      process.kill(pid, 'SIGKILL')
      killed++
    } catch {
      // Already gone.
    }
  }
  const dirs = [...ownedDirs]
  ownedDirs.clear()
  await Promise.all(dirs.map((name) => rm(`/tmp/${name}`, { recursive: true, force: true }).catch(() => undefined)))
  return { killed, removedDirs: dirs.length }
}

export async function diagnose(executablePath: string): Promise<Diagnostics> {
  let tmpFreeMb: number | null = null
  try {
    const stats = await statfs('/tmp')
    tmpFreeMb = mb(stats.bavail * stats.bsize)
  } catch {
    // The figure stays unknown.
  }
  const { ours: processes, outside } = await scanChromium(executablePath)
  return {
    tmpFreeMb,
    playwrightDirs: (await playwrightDirs()).length,
    chromiumProcesses: processes.length,
    strayProcesses: outside.length,
    chromiumRssMb: mb(processes.reduce((sum, p) => sum + p.rssKb * 1024, 0)),
    functionRssMb: mb(process.memoryUsage().rss),
  }
}

/** True when the container should be retired after this response: low disk, high memory, a browser left behind (in this tree or outside it), or a navigation that failed on the network. */
export function shouldRecycle(diagnostics: Diagnostics, networkFailure: boolean): boolean {
  return networkFailure
    || (diagnostics.tmpFreeMb !== null && diagnostics.tmpFreeMb < MIN_TMP_FREE_MB)
    || diagnostics.chromiumProcesses > 0
    || diagnostics.strayProcesses > 0
    || diagnostics.chromiumRssMb + diagnostics.functionRssMb > MAX_RSS_MB
}

/**
 * Starts headless Chromium inside this function. Anything an earlier run of this process left in
 * /tmp or in the process table is removed first. A start that arrives after the limit is closed as soon as it resolves, so no browser is left running.
 */
export async function launchBrowser(): Promise<Launched> {
  const started = Date.now()
  let abandoned = false
  const starting = (async () => {
    const executablePath = await chromium.executablePath()
    const unpackMs = Date.now() - started
    await reapChromium(executablePath)
    const before = new Set(await playwrightDirs())
    const browser = await playwright.launch({ executablePath, args: chromium.args, headless: true })
    for (const name of await playwrightDirs()) if (!before.has(name)) ownedDirs.add(name)
    return { browser, executablePath, unpackMs }
  })()
  void starting.then(
    (late) => {
      if (abandoned) void late.browser.close().catch(() => undefined)
    },
    () => undefined,
  )
  try {
    const { browser, executablePath, unpackMs } = await withTimeout(starting, LAUNCH_TIMEOUT_MS, 'The browser did not start in time.')
    return { browser, executablePath, version: browser.version(), unpackMs }
  } catch (error) {
    abandoned = true
    if (error instanceof ExecutionError) throw error
    // The reason stays in the function log. The visitor gets a plain sentence.
    console.error('Browser launch failed:', error instanceof Error ? error.message.slice(0, 300) : 'unknown error')
    throw new ExecutionError('The browser could not start. Try again in a moment.')
  }
}

export interface Closed {
  /** False when the browser did not close in time. */
  closed: boolean
  diagnostics: Diagnostics
  retire: boolean
}

/**
 * Closes the browser under the time limit, then makes sure nothing is left: stray Chromium processes are ended
 * and Playwright's folders in /tmp are removed. The state of the container is logged, and `retire` says whether
 * the container should end after this response.
 */
export async function closeBrowser(launched: Launched, networkFailure: boolean): Promise<Closed> {
  let closed = true
  try {
    await withTimeout(launched.browser.close(), BROWSER_TIMEOUT_MS, 'The browser did not close in time.')
  } catch {
    closed = false
  }
  const reaped = await reapChromium(launched.executablePath)
  const diagnostics = await diagnose(launched.executablePath)
  const retire = shouldRecycle(diagnostics, networkFailure) || reaped.killed > 0
  console.log('Run finished:', JSON.stringify({ ...diagnostics, ...reaped, closed, networkFailure, retire }))
  return { closed, diagnostics, retire }
}

/** Ends this container after the response has gone out, so the next request starts on a fresh one. */
export function retireContainer(exit: (code: number) => void = (code) => process.exit(code)): void {
  setTimeout(() => exit(0), 500)
}
