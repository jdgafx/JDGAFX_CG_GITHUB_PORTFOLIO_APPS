import { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromiumProcesses, descendantsOf, diagnose, hasRoom, parentOf, reapChromium, scanChromium, sweepDir, topEntries } from '../../netlify/shared/session'

const MARKER = '/test-only/leftover-chromium-marker'

describe('room in /tmp', () => {
  it('has room at 150 MB free or more, none below, and counts an unreadable figure as room', () => {
    expect(hasRoom(150)).toBe(true)
    expect(hasRoom(149)).toBe(false)
    expect(hasRoom(null)).toBe(true)
  })
})

describe('cleaning a folder', () => {
  async function scratch(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'bb-sweep-test-'))
    await mkdir(join(root, 'chromium-keep'))
    await writeFile(join(root, 'chromium-keep', 'bin'), Buffer.alloc(3 * 1_048_576, 1))
    await mkdir(join(root, 'leak-dir'))
    await writeFile(join(root, 'leak-dir', 'cache'), Buffer.alloc(5 * 1_048_576, 2))
    await writeFile(join(root, 'leak-file'), Buffer.alloc(2 * 1_048_576, 3))
    return root
  }

  it('lists the biggest entries by name and size in MB, folders counted in full', async () => {
    const root = await scratch()
    try {
      expect(await topEntries(root, 8)).toEqual([
        { name: 'leak-dir', mb: 5 },
        { name: 'chromium-keep', mb: 3 },
        { name: 'leak-file', mb: 2 },
      ])
      expect(await topEntries(root, 1)).toEqual([{ name: 'leak-dir', mb: 5 }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('removes what is not on the keep list and nothing that is', async () => {
    const root = await scratch()
    try {
      expect(await sweepDir(root, new Set(['chromium-keep']))).toBe(2)
      expect(await readdir(root)).toEqual(['chromium-keep'])
      expect(await readFile(join(root, 'chromium-keep', 'bin'))).toHaveLength(3 * 1_048_576)
      expect(await sweepDir(root, new Set(['chromium-keep']))).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('leftover browsers', () => {
  it('finds a process by the Chromium path in its command line, ends it, and finds none afterwards', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', MARKER], { stdio: 'ignore' })
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    try {
      await vi.waitFor(async () => expect((await chromiumProcesses(MARKER)).map((p) => p.pid)).toContain(child.pid), { timeout: 5_000 })
      const found = (await chromiumProcesses(MARKER)).find((p) => p.pid === child.pid)
      expect(found?.rssKb).toBeGreaterThan(1_000)

      const reaped = await reapChromium(MARKER)
      expect(reaped.killed).toBe(1)
      await exited
      expect(await chromiumProcesses(MARKER)).toEqual([])
    } finally {
      child.kill('SIGKILL')
    }
  })

  it('reports the state of the container: free space, folders, processes and memory', async () => {
    const diagnostics = await diagnose(MARKER)
    expect(diagnostics.tmpFreeMb).toBeGreaterThan(0)
    expect(diagnostics.chromiumProcesses).toBe(0)
    expect(diagnostics.functionRssMb).toBeGreaterThan(10)
  })

  it('removes no folder it did not make', async () => {
    expect(await reapChromium(MARKER)).toEqual({ killed: 0, removedDirs: 0 })
  })
})

describe('only this process tree', () => {
  it('reads the parent id from a stat line, even when the command name holds spaces and brackets', () => {
    expect(parentOf('4242 (my (odd) name) S 1234 4242 4242 0 -1')).toBe(1234)
    expect(parentOf('nonsense')).toBeNull()
  })

  it('follows parents down: children, grandchildren, and nothing else', () => {
    const table = [{ pid: 11, ppid: 10 }, { pid: 12, ppid: 11 }, { pid: 20, ppid: 1 }, { pid: 21, ppid: 20 }]
    expect([...descendantsOf(10, table)].sort()).toEqual([11, 12])
    expect(descendantsOf(99, table).size).toBe(0)
  })

  it('never selects a process outside the tree, even one whose command line matches', async () => {
    // The shell starts node in the background and exits, so node is handed to init: it is not ours.
    const shell = spawn('sh', ['-c', `${process.execPath} -e "setTimeout(() => {}, 60000)" ${MARKER}-orphan &`], { stdio: 'ignore' })
    await new Promise<void>((resolve) => shell.once('exit', () => resolve()))
    let orphan: number | undefined
    try {
      await vi.waitFor(async () => {
        for (const entry of await readdir('/proc')) {
          const pid = Number(entry)
          if (!Number.isInteger(pid)) continue
          const command = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')
          if (command.includes(`${MARKER}-orphan`)) orphan = pid
        }
        expect(orphan).toBeDefined()
      }, { timeout: 5_000 })
      expect(await chromiumProcesses(`${MARKER}-orphan`)).toEqual([])
      // It is not ended, but it is counted and logged.
      expect((await scanChromium(`${MARKER}-orphan`)).outside).toEqual([orphan])
      const diagnostics = await diagnose(`${MARKER}-orphan`)
      expect(diagnostics).toMatchObject({ chromiumProcesses: 0, strayProcesses: 1 })
      expect(await reapChromium(`${MARKER}-orphan`)).toEqual({ killed: 0, removedDirs: 0 })
      // The process is still running: it was left alone.
      expect(() => process.kill(orphan as number, 0)).not.toThrow()
    } finally {
      if (orphan) process.kill(orphan, 'SIGKILL')
    }
  })
})
