import { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { chromiumProcesses, descendantsOf, diagnose, parentOf, scanChromium, reapChromium, retireContainer, shouldRecycle, type Diagnostics } from '../../netlify/shared/session'

const MARKER = '/test-only/leftover-chromium-marker'

const calm: Diagnostics = { tmpFreeMb: 400, playwrightDirs: 0, chromiumProcesses: 0, strayProcesses: 0, chromiumRssMb: 0, functionRssMb: 120 }

describe('shouldRecycle', () => {
  it('keeps a container that is clean, with room in /tmp and memory to spare', () => {
    expect(shouldRecycle(calm, false)).toBe(false)
  })

  it.each([
    ['a navigation that failed on the network', calm, true],
    ['low room in /tmp', { ...calm, tmpFreeMb: 150 }, false],
    ['a browser process left behind', { ...calm, chromiumProcesses: 1 }, false],
    ['a browser process left behind outside this tree, such as an orphan handed to init', { ...calm, strayProcesses: 1 }, false],
    ['more than 850 MB held by the function and its browser', { ...calm, chromiumRssMb: 740, functionRssMb: 120 }, false],
  ])('retires a container after %s', (_name, diagnostics, network) => {
    expect(shouldRecycle(diagnostics, network)).toBe(true)
  })

  it('does not retire over a figure it could not read', () => {
    expect(shouldRecycle({ ...calm, tmpFreeMb: null }, false)).toBe(false)
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
      // It is not ended, but it is counted, so the container retires after the response.
      expect((await scanChromium(`${MARKER}-orphan`)).outside).toEqual([orphan])
      const diagnostics = await diagnose(`${MARKER}-orphan`)
      expect(diagnostics).toMatchObject({ chromiumProcesses: 0, strayProcesses: 1 })
      expect(shouldRecycle(diagnostics, false)).toBe(true)
      expect(await reapChromium(`${MARKER}-orphan`)).toEqual({ killed: 0, removedDirs: 0 })
      // The process is still running: it was left alone.
      expect(() => process.kill(orphan as number, 0)).not.toThrow()
    } finally {
      if (orphan) process.kill(orphan, 'SIGKILL')
    }
  })
})

describe('retireContainer', () => {
  it('ends the process after the response has gone out, not before', async () => {
    vi.useFakeTimers()
    const exit = vi.fn()
    retireContainer(exit)
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(exit).toHaveBeenCalledWith(0)
    vi.useRealTimers()
  })
})
