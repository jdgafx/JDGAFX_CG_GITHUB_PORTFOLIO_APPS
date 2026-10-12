#!/usr/bin/env node
// Records every app that has a config file (or just --app <app>), one after another, each in its own record.mjs process.
// An app that fails does not stop the others; the exit code is 1 if any failed. Usage: node record-all.mjs --out dir [--app <app|all>]
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigError, listApps, loadAppConfig, recordApps } from './lib.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []))
if (!args.out) {
  console.error('usage: node record-all.mjs --out <dir> [--app <app|all>]')
  process.exit(2)
}
let apps
try {
  apps = !args.app || args.app === 'all' ? listApps() : (loadAppConfig(args.app), [args.app])
} catch (err) {
  if (!(err instanceof ConfigError)) throw err
  console.error(err.message)
  process.exit(2)
}
if (apps.length === 0) {
  console.error('no app has a config file')
  process.exit(2)
}

const recorder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'record.mjs')
const { ok, failed } = await recordApps(apps, app => {
  console.log(`::group::record ${app}`)
  const result = spawnSync(process.execPath, [recorder, '--app', app, '--out', args.out], { stdio: 'inherit' })
  console.log('::endgroup::')
  if (result.status !== 0) console.error(`::error::recording ${app} failed`)
  return result.status === 0
})
console.log(`recorded: ${ok.join(', ') || 'none'}`)
if (failed.length > 0) {
  console.error(`FAILED: ${failed.join(', ')}`)
  process.exit(1)
}
