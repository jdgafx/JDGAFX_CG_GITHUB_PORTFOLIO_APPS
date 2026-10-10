import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Project rule: every source file stays under 500 lines. */
const LIMIT = 500

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx|css)$/.test(name) ? [path] : []
  })
}

/** Lines as an editor counts them: a trailing newline does not start a new line. */
function lineCount(path: string): number {
  return readFileSync(path, 'utf8').replace(/\n$/, '').split('\n').length
}

describe('file length', () => {
  const sources = [...files('src'), ...files('netlify')]

  it('finds the stylesheets it guards', () => {
    expect(sources).toEqual(expect.arrayContaining(['src/styles/app.css', 'src/styles/replay.css']))
  })

  it('keeps every source file under 500 lines', () => {
    const long = sources.map((path) => [path, lineCount(path)] as const).filter(([, lines]) => lines >= LIMIT)
    expect(long).toEqual([])
  })
})
