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
//   reported { model, modelRole, costUsd, costScope } (read from the recorded bodies, never from the screen). costUsd is one
//     spec, or an array of specs whose values are summed (a * fans out and every value is added; a missing or non-numeric
//     value refuses the run),
//   sse (optional, for apps whose replies are text/event-stream): { frame, take, path }. The body that expect/reported read
//     is chosen from the reply's parsed data: frames (a literal [DONE] is skipped). `frame` filters them: {field, equals}
//     keeps frames whose dotted field equals the value, {has} keeps frames that carry the dotted field; omitted keeps all.
//     `take` is 'last' (default), 'first', or 'all' (the body is the array of kept frames, so a * in expect/reported reaches
//     into each). `path` then picks a dotted field inside each kept frame (a kept frame without it refuses the run); omitted keeps whole frames.
//     That is one rule for every event-stream reply of the app; or sse may be an object keyed by request path (every key
//     starting with /), each value such a rule, and an event-stream reply on a path without a rule is refused.
//     JSON replies are parsed as before.
export const APPS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'apps')
const APP_NAME = /^[a-z0-9][a-z0-9-]*$/

// Thrown for a missing or malformed per-app config file.
export class ConfigError extends Error {}

const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v)
const isPath = v => typeof v === 'string' && v.startsWith('/')
const isSpec = v => isObject(v) && isPath(v.path) && typeof v.field === 'string' && v.field !== ''

// An sse object whose keys are all request paths is a map of rules by path; anything else is one rule.
const isSsePaths = sse => Object.keys(sse).length > 0 && Object.keys(sse).every(isPath)

function checkSseRule(rule, name, bad) {
  if (!isObject(rule)) throw bad(`${name} must be an object`)
  const f = rule.frame
  const nonEmpty = v => typeof v === 'string' && v !== ''
  if (f !== undefined && !(isObject(f) && (nonEmpty(f.has) ? f.field === undefined && f.equals === undefined : nonEmpty(f.field) && f.equals !== undefined))) {
    throw bad(`${name}.frame must be {field, equals} or {has}`)
  }
  if (rule.take !== undefined && !['first', 'last', 'all'].includes(rule.take)) throw bad(`${name}.take must be 'first', 'last' or 'all'`)
  if (rule.path !== undefined && !nonEmpty(rule.path)) throw bad(`${name}.path must be a dotted field name`)
}

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
  if (c.sse !== undefined) {
    if (!isObject(c.sse)) throw bad('sse must be an object')
    if (isSsePaths(c.sse)) for (const [p, rule] of Object.entries(c.sse)) checkSseRule(rule, `sse['${p}']`, bad)
    else checkSseRule(c.sse, 'sse', bad)
  }
  const r = c.reported
  if (!isObject(r) || !isSpec(r.model) || !(Array.isArray(r.costUsd) ? r.costUsd.length > 0 && r.costUsd.every(isSpec) : isSpec(r.costUsd)) || typeof r.modelRole !== 'string' || typeof r.costScope !== 'string') {
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

const isEventStream = headers => headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1]?.trim().toLowerCase().startsWith('text/event-stream') === true

// The JSON of every data: frame of an event stream, in order. Frames end at a blank line; several data: lines in one
// frame join with a newline; comment and other fields (event:, id:, retry:) are ignored; a literal [DONE] is the
// conventional end marker, not a frame. A frame whose data is not JSON refuses the run.
function sseFrames(text, where) {
  const frames = []
  for (const block of text.split(/\r\n\r\n|\n\n|\r\r/)) {
    const data = block.split(/\r\n|\n|\r/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, ''))
    if (data.length === 0) continue
    const raw = data.join('\n')
    if (raw.trim() === '[DONE]') continue
    try {
      frames.push(JSON.parse(raw))
    } catch {
      throw new RefusedRun(`${where} sent an event-stream frame that is not JSON`)
    }
  }
  return frames
}

// The body expect/reported read from an event-stream reply, chosen by the app's sse rule.
function sseBody(text, ssePaths, path, where) {
  const sse = ssePaths && (isSsePaths(ssePaths) ? ssePaths[path.split('?')[0]] ?? ssePaths[path] : ssePaths)
  if (!sse) throw new RefusedRun(`${where} answered with an event stream but the app config has no sse rule${ssePaths ? ' for that path' : ''}`)
  const frames = sseFrames(text, where)
  const f = sse.frame
  const keep = !f ? () => true : f.has !== undefined ? frame => valuesAt(frame, f.has)[0] !== undefined : frame => valuesAt(frame, f.field)[0] === f.equals
  const hits = frames.filter(keep)
  if (hits.length === 0) throw new RefusedRun(`${where} never sent a frame ${!f ? '' : f.has !== undefined ? `with ${f.has}` : `with ${f.field} = ${JSON.stringify(f.equals)}`}`.trim())
  const pick = frame => {
    if (sse.path === undefined) return frame
    const value = valuesAt(frame, sse.path)[0]
    if (value === undefined) throw new RefusedRun(`${where} chosen frame has no ${sse.path}`)
    return value
  }
  if (sse.take === 'all') return hits.map(pick)
  return pick(sse.take === 'first' ? hits[0] : hits[hits.length - 1])
}

function satisfies(value, e) {
  if (e.equals !== undefined && value !== e.equals) return false
  if (e.minLength !== undefined && !(Array.isArray(value) && value.length >= e.minLength)) return false
  if (e.nonEmpty === true && !(typeof value === 'string' && value.length > 0)) return false
  return true
}

const isCost = v => typeof v === 'number' && Number.isFinite(v) && v >= 0

function singleCost(spec, bodies) {
  const usd = valuesAt(bodies[spec.path], spec.field)[0]
  if (!isCost(usd)) throw new RefusedRun(`the ${spec.path} reply reports no cost`)
  return usd
}

// Every value each spec reaches (a * fans out) is added; none may be missing or non-numeric.
function summedCost(specs, bodies) {
  let total = 0
  for (const spec of specs) {
    if (!(spec.path in bodies)) throw new RefusedRun(`the run never reached ${spec.path}, which reports cost`)
    const values = valuesAt(bodies[spec.path], spec.field)
    if (values.length === 0 || !values.every(isCost)) throw new RefusedRun(`the ${spec.path} reply reports no cost at ${spec.field}`)
    for (const v of values) total += v
  }
  return total
}

function reportedFrom(config, bodies) {
  const { model, modelRole, costUsd, costScope } = config.reported
  const m = valuesAt(bodies[model.path], model.field)[0]
  if (typeof m !== 'string' || m === '') throw new RefusedRun(`the ${model.path} reply names no model`)
  return { model: m, model_role: modelRole, cost_usd: Array.isArray(costUsd) ? summedCost(costUsd, bodies) : singleCost(costUsd, bodies), cost_scope: costScope }
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
    if (isEventStream(e.headers)) {
      bodies[e.path] = sseBody(text, config.sse, e.path, `${e.method} ${e.path}`)
    } else {
      try {
        bodies[e.path] = JSON.parse(text)
      } catch {
        throw new RefusedRun(`${e.method} ${e.path} did not answer with JSON`)
      }
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
