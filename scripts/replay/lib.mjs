// The pure part of the recorder: turns what the page logged into a recording, or refuses. No browser here, so it is testable.

export const FORMAT_VERSION = 1

// Thrown when the run must not be saved: it errored, did not finish, or did not report what the label needs.
export class RefusedRun extends Error {}

const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v)
const round = ms => Math.round(ms * 10) / 10

// Per-app knowledge: what the built-in example is, which reply ends it, and where its model and cost are reported.
export const APPS = {
  'app-06-llm-playground': {
    tryButton: 'Try it',
    finishPath: '/api/judge',
    // Read from the recorded response bodies, never from the screen. A blind compare names no model and gives no cost,
    // so only the judge call's own figures are reported (and labelled as such).
    check(bodies) {
      const compare = bodies['/api/compare']
      const judge = bodies['/api/judge']
      if (!isObject(compare) || compare.blind !== true || !Array.isArray(compare.answers) || compare.answers.length < 2) {
        throw new RefusedRun('compare did not return blind answers')
      }
      if (!compare.answers.every(a => isObject(a) && a.ok === true && typeof a.text === 'string' && a.text.length > 0)) {
        throw new RefusedRun('a panel did not answer')
      }
      if (!isObject(judge) || judge.ok !== true) throw new RefusedRun('the judge did not give a verdict')
      if (typeof judge.model !== 'string' || judge.model === '') throw new RefusedRun('the judge reply names no model')
      const usd = isObject(judge.cost) ? judge.cost.usd : undefined
      if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) throw new RefusedRun('the judge reply reports no cost')
      return { model: judge.model, model_role: 'judge', cost_usd: usd, cost_scope: 'judge call' }
    },
  },
}

/**
 * exchanges: what the page logged, times in ms on the page clock; t0 is the click. Returns the recording object.
 * Throws RefusedRun for anything that is not one complete, successful run.
 */
export function buildRecording({ app, url, recordedAt, t0, exchanges }) {
  const config = APPS[app]
  if (!config) throw new RefusedRun(`unknown app ${app}`)
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
  const reported = config.check(bodies)
  return { version: FORMAT_VERSION, app, url, recorded_at: recordedAt, reported, exchanges: out }
}
