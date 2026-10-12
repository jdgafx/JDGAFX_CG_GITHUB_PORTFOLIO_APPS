import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// A throwaway repo root holding copies of the two scripts, a shared/replay, and the given app dirs.
function fakeRepo(apps) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'replay-sync-'))
  mkdirSync(path.join(root, 'scripts/replay'), { recursive: true })
  for (const f of ['sync.sh', 'check-sync.sh']) copyFileSync(path.join(here, f), path.join(root, 'scripts/replay', f))
  mkdirSync(path.join(root, 'shared/replay'), { recursive: true })
  writeFileSync(path.join(root, 'shared/replay/a.ts'), 'export const a = 1\n')
  writeFileSync(path.join(root, 'shared/replay/b.ts'), 'export const b = 2\n')
  for (const app of apps) mkdirSync(path.join(root, app, 'src', app === 'app-no-replay' ? 'other' : 'replay'), { recursive: true })
  return root
}
const run = (root, script) => spawnSync('bash', [path.join(root, 'scripts/replay', script)], { encoding: 'utf8' })

test('sync copies shared/replay into every app that has src/replay and no other app', () => {
  const root = fakeRepo(['app-01-x', 'app-02-y', 'app-no-replay'])
  writeFileSync(path.join(root, 'app-01-x/src/replay/stale.ts'), 'old')
  const r = run(root, 'sync.sh')
  assert.equal(r.status, 0, r.stderr)
  for (const app of ['app-01-x', 'app-02-y']) {
    assert.equal(readFileSync(path.join(root, app, 'src/replay/b.ts'), 'utf8'), 'export const b = 2\n')
  }
  assert.ok(!existsSync(path.join(root, 'app-01-x/src/replay/stale.ts')))
  assert.ok(!existsSync(path.join(root, 'app-no-replay/src/replay')))
  assert.match(r.stdout, /app-01-x app-02-y/)
})

test('check-sync passes when copies match and fails naming the app that differs', () => {
  const root = fakeRepo(['app-01-x', 'app-02-y'])
  assert.equal(run(root, 'sync.sh').status, 0)
  assert.equal(run(root, 'check-sync.sh').status, 0)
  writeFileSync(path.join(root, 'app-02-y/src/replay/a.ts'), 'tampered')
  let r = run(root, 'check-sync.sh')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /DIFFERS: app-02-y/)
  assert.doesNotMatch(r.stderr, /app-01-x/)
  assert.equal(run(root, 'sync.sh').status, 0)
  writeFileSync(path.join(root, 'app-01-x/src/replay/extra.ts'), 'x')
  r = run(root, 'check-sync.sh')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /DIFFERS: app-01-x/)
})

test('with no app that replays, both scripts succeed and touch nothing', () => {
  const root = fakeRepo(['app-no-replay'])
  assert.equal(run(root, 'sync.sh').status, 0)
  assert.equal(run(root, 'check-sync.sh').status, 0)
})

test('a newly added app dir is picked up without editing the scripts', () => {
  const root = fakeRepo([])
  mkdirSync(path.join(root, 'app-13-new/src/replay'), { recursive: true })
  assert.equal(run(root, 'sync.sh').status, 0)
  assert.ok(existsSync(path.join(root, 'app-13-new/src/replay/a.ts')))
})
