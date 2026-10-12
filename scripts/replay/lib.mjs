// The pure part of the recorder: turns what the page logged into a recording, or refuses. No browser here, so it is testable.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const FORMAT_VERSION = 1

// Thrown when the run must not be saved: it errored, did not finish, or did not report what the label needs.
export class RefusedRun extends Error {}

const round = ms => Math.round(ms * 10) / 10

// Per-app knowledge lives in apps/<app>.json, never in code: what the built-in example is, which reply ends it, what a
// good run looks like and where its model and cost are reported. Fields:
//   url, tryButton, finishPath, apiPrefix, settleMs (optional), expect (checks on the recorded reply bodies),
//   reported { model, modelRole, costUsd, costScope } (read from the recorded bodies, never from the screen).
export const APPS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'apps')
const APP_NAME = /^[a-z0-9][a-z0-9-]*$/

// Thrown for a missing or malformed per-app config file.
export class ConfigError extends Error {}

const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v)
const isPath = v => typeof v === 'string' && v.startsWith('/')
const isSpec = v => isObject(v) && isPath(v.path) && typeof v.field === 'string' && v.field !== ''

export function listApps(dir = APPS_DIR) {
  return readdirSync(dir).filter(f => f.endsWith('.json') && APP_NAME.test(f.slice(0, -5))).map(f => f.slice(0, -5)).sort()
}

export function loadAppConfig(app, dir = APPS_DIR) {
  if (typeof app !== 'string' || !APP_NAME.test(app)) throw new ConfigError(`unknown app '${app}'`)
  const file = path.join(dir, `${app}.json`)
  if (!existsSync(file)) throw new ConfigError(`unknown app '${app}': no config file ${app}.json`)
  let c
  try {
    c = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new ConfigError(`${app}.json is not valid JSON: ${err.message}`)
  }
  const bad = why => new ConfigError(`${app}.json: ${why}`)
  if (!isObject(c)) throw bad('must be an object')
  if (typeof c.url !== 'string' || !/^https:\/\/[^/]+\//.test(c.url)) throw bad('url must be an https URL ending in a path')
  if (typeof c.tryButton !== 'string' || c.tryButton === '') throw bad('tryButton must be the example button name')
  if (!isPath(c.finishPath)) throw bad('finishPath must start with /')
  if (!isPath(c.apiPrefix)) throw bad('apiPrefix must start with /')
  if (c.settleMs !== undefined && !(Number.isInteger(c.settleMs) && c.settleMs >= 0 && c.settleMs <= 60_000)) throw bad('settleMs must be 0 to 60000')
  if (!Array.isArray(c.expect) || !c.expect.every(e => isSpec(e) && (e.equals !== undefined || e.minLength !== undefined || e.nonEmpty === true))) {
    throw bad('expect must list {path, field, equals | minLength | nonEmpty}')
  }
  const r = c.reported
  if (!isObject(r) || !isSpec(r.model) || !isSpec(r.costUsd) || typeof r.modelRole !== 'string' || typeof r.costScope !== 'string') {
    throw bad('reported needs model, modelRole, costUsd and costScope')
  }
  return c
}

/**
 * Runs record(app) for each app one after another. A failure (thrown error or false) never stops the rest.
 * Returns { ok: [...], failed: [...] } in order.
 */
export async function recordApps(apps, record) {
  const ok = []
  const failed = []
  for (const app of apps) {
    let success = false
    try {
      success = (await record(app)) !== false
    } catch {
      success = false
    }
    ;(success ? ok : failed).push(app)
  }
  return { ok, failed }
}

// Values at a dotted path; a * segment fans out over an array. A missing step yields undefined.
function valuesAt(body, field) {
  let current = [body]
  for (const key of field.split('.')) {
    current = current.flatMap(v => (key === '*' ? (Array.isArray(v) ? v : [undefined]) : [isObject(v) || Array.isArray(v) ? v[key] : undefined]))
  }
  return current
}

function satisfies(value, e) {
  if (e.equals !== undefined && value !== e.equals) return false
  if (e.minLength !== undefined && !(Array.isArray(value) && value.length >= e.minLength)) return false
  if (e.nonEmpty === true && !(typeof value === 'string' && value.length > 0)) return false
  return true
}

function reportedFrom(config, bodies) {
  const { model, modelRole, costUsd, costScope } = config.reported
  const m = valuesAt(bodies[model.path], model.field)[0]
  if (typeof m !== 'string' || m === '') throw new RefusedRun(`the ${model.path} reply names no model`)
  const usd = valuesAt(bodies[costUsd.path], costUsd.field)[0]
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) throw new RefusedRun(`the ${costUsd.path} reply reports no cost`)
  return { model: m, model_role: modelRole, cost_usd: usd, cost_scope: costScope }
}

/**
 * exchanges: what the page logged, times in ms on the page clock; t0 is the click. Returns the recording object.
 * Throws RefusedRun for anything that is not one complete, successful run.
 */
export function buildRecording({ app, config, url, recordedAt, t0, exchanges }) {
  if (typeof t0 !== 'number') throw new RefusedRun('the example was never started (no click seen)')
  const after = exchanges.filter(e => e.t_start >= t0)
  if (after.length === 0) throw new RefusedRun('no request was made after the click')
  const bodies = {}
  const out = after.map(e => {
    if (e.error) throw new RefusedRun(`${e.method} ${e.path} failed: ${e.error}`)
    if (!e.done) throw new RefusedRun(`${e.method} ${e.path} did not finish`)
    if (!Number.isInteger(e.status) || e.status < 200 || e.status > 299) throw new RefusedRun(`${e.method} ${e.path} answered ${e.status}`)
    const text = e.chunks.map(c => c.text).join('')
    try {
      bodies[e.path] = JSON.parse(text)
    } catch {
      throw new RefusedRun(`${e.method} ${e.path} did not answer with JSON`)
    }
    const contentType = e.headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1]
    return {
      method: e.method,
      path: e.path,
      request_body: e.request_body,
      status: e.status,
      headers: contentType ? { 'content-type': contentType } : {},
      t_start: round(e.t_start - t0),
      t_headers: round(e.t_headers - t0),
      t_end: round(e.t_end - t0),
      chunks: e.chunks.map(c => ({ t: round(c.t - t0), text: c.text })),
    }
  })
  if (!out.some(e => e.path === config.finishPath)) throw new RefusedRun(`the run never reached ${config.finishPath}`)
  for (const e of config.expect) {
    if (!(e.path in bodies)) throw new RefusedRun(`the run never reached ${e.path}`)
    const values = valuesAt(bodies[e.path], e.field)
    if (values.length === 0 || !values.every(v => satisfies(v, e))) throw new RefusedRun(e.message ?? `${e.path} ${e.field} is not as expected`)
  }
  const reported = reportedFrom(config, bodies)
  return { version: FORMAT_VERSION, app, url, recorded_at: recordedAt, reported, exchanges: out }
}
