import { lstat, readdir, readFile, rm, statfs } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import chromium from '@sparticuz/chromium'
import { chromium as playwright, type Browser } from 'playwright-core'
import { ExecutionError, withTimeout } from './browser'

/** Longest the browser may take to start. The first start after a cold function unpacks Chromium into /tmp. */
export const LAUNCH_TIMEOUT_MS = 12_000
/** Longest a page open or a browser close may take. */
export const BROWSER_TIMEOUT_MS = 7_000
/** A run is refused, with a retryable message, when /tmp has less than this much room left after cleaning. */
const MIN_TMP_FREE_MB = 150
/** The profile and artifact folders Playwright makes in the temp folder (/tmp in a function) for every browser it starts. */
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
  /** The biggest top-level entries in /tmp, so a leak shows up in the log by name. */
  topTmp: Array<{ name: string; mb: number }>
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
    return (await readdir(tmpdir())).filter((name) => PLAYWRIGHT_TEMP.test(name))
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
  await Promise.all(dirs.map((name) => rm(join(tmpdir(), name), { recursive: true, force: true }).catch(() => undefined)))
  return { killed, removedDirs: dirs.length }
}

/** The disk space an entry takes, in MB. A folder counts everything in it. One shared budget limits how many entries are read in all, so a crowded /tmp cannot slow a run. */
async function sizeBytes(path: string, budget: { left: number }): Promise<number> {
  if (budget.left-- <= 0) return 0
  try {
    const info = await lstat(path)
    if (!info.isDirectory()) return info.size
    const names = await readdir(path)
    const sizes = await Promise.all(names.map((name) => sizeBytes(join(path, name), budget)))
    return sizes.reduce((sum, size) => sum + size, 0)
  } catch {
    return 0
  }
}

/** The biggest entries of a folder, by name and size in MB, at most `count` of them. */
export async function topEntries(root: string, count = 8): Promise<Array<{ name: string; mb: number }>> {
  const names = await readdir(root).catch(() => [] as string[])
  const budget = { left: 4_000 }
  const sized: Array<{ name: string; mb: number }> = []
  for (const name of names) sized.push({ name, mb: Math.round((await sizeBytes(join(root, name), budget)) / 1_048_576) })
  return sized.sort((a, b) => b.mb - a.mb).slice(0, count)
}

/** Removes every entry of `root` that is not in `keep`, and returns how many it removed. */
export async function sweepDir(root: string, keep: ReadonlySet<string>): Promise<number> {
  const names = (await readdir(root).catch(() => [] as string[])).filter((name) => !keep.has(name))
  await Promise.all(names.map((name) => rm(join(root, name), { recursive: true, force: true }).catch(() => undefined)))
  return names.length
}

/** True when a free-space figure leaves room for a browser. A figure that could not be read counts as room. */
export function hasRoom(freeMb: number | null): boolean {
  return freeMb === null || freeMb >= MIN_TMP_FREE_MB
}

async function freeTmpMb(): Promise<number | null> {
  try {
    const stats = await statfs(tmpdir())
    return mb(stats.bavail * stats.bsize)
  } catch {
    return null
  }
}

/**
 * What /tmp held once Chromium was unpacked: its binary and helper files. Everything else in /tmp is a leftover of a
 * run. The sweep runs only inside a function container (AWS_LAMBDA_FUNCTION_NAME is set), where /tmp belongs to the
 * function alone. On any other machine, such as a developer's, only the folders this process's own browsers made are removed.
 */
let baseline: Set<string> | null = null
const inFunctionContainer = (): boolean => Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME)

async function sweepLeftovers(): Promise<number> {
  return inFunctionContainer() && baseline ? sweepDir(tmpdir(), baseline) : 0
}

export async function diagnose(executablePath: string): Promise<Diagnostics> {
  const { ours: processes, outside } = await scanChromium(executablePath)
  return {
    tmpFreeMb: await freeTmpMb(),
    playwrightDirs: (await playwrightDirs()).length,
    topTmp: await topEntries(tmpdir()),
    chromiumProcesses: processes.length,
    strayProcesses: outside.length,
    chromiumRssMb: mb(processes.reduce((sum, p) => sum + p.rssKb * 1024, 0)),
    functionRssMb: mb(process.memoryUsage().rss),
  }
}

/**
 * Starts headless Chromium inside this function. /tmp is cleaned first, so leftovers of an earlier run cannot
 * pile up, and a run is refused with a retryable message when there is still no room. A start that arrives after the
 * limit is closed as soon as it resolves, so no browser is left running.
 */
export async function launchBrowser(): Promise<Launched> {
  const started = Date.now()
  let abandoned = false
  const starting = (async () => {
    const executablePath = await chromium.executablePath()
    const unpackMs = Date.now() - started
    baseline ??= new Set(await readdir(tmpdir()).catch(() => [] as string[]))
    await reapChromium(executablePath)
    await sweepLeftovers()
    if (!hasRoom(await freeTmpMb())) throw new ExecutionError('The browser service is out of room. Try again in a moment.')
    const before = new Set(await playwrightDirs())
    const browser = await playwright.launch({ executablePath, args: [...chromium.args, '--disk-cache-size=1', '--media-cache-size=1'], headless: true })
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
}

/**
 * Closes the browser under the time limit, then makes sure nothing is left: this process's own Chromium processes are
 * ended, the folders its browsers made are removed, and in a function container everything new in /tmp goes. The state
 * of the container is logged, with the biggest entries of /tmp by name.
 */
export async function closeBrowser(launched: Launched): Promise<Closed> {
  let closed = true
  try {
    await withTimeout(launched.browser.close(), BROWSER_TIMEOUT_MS, 'The browser did not close in time.')
  } catch {
    closed = false
  }
  const reaped = await reapChromium(launched.executablePath)
  const swept = await sweepLeftovers()
  const diagnostics = await diagnose(launched.executablePath)
  console.log('Run finished:', JSON.stringify({ ...diagnostics, ...reaped, swept, closed }))
  return { closed, diagnostics }
}
