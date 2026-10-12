import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildRecording, ConfigError, listApps, loadAppConfig, recordApps, RefusedRun } from './lib.mjs'

const app = 'app-06-llm-playground'
const config = loadAppConfig(app)
const compare = { blind: true, runId: 'r', answers: [{ label: 'A', ok: true, text: 'a' }, { label: 'B', ok: true, text: 'b' }, { label: 'C', ok: true, text: 'c' }] }
const judge = { ok: true, model: 'vendor/judge-1', cost: { usd: 0.0004, source: 'usage' } }
const json = (t, body) => ({ t, text: JSON.stringify(body) })
const exchange = (path, t, body, change = {}) => ({
  method: 'POST', path, request_body: '{}', status: 200, headers: [['Content-Type', 'application/json'], ['Set-Cookie', 'x=1']],
  t_start: t, t_headers: t + 1000, t_end: t + 1000, chunks: [json(t + 1000, body)], done: true, error: null, ...change,
})
const base = () => ({ app, config, url: 'https://example.test/', recordedAt: '2026-10-12T00:00:00.000Z', t0: 5000, exchanges: [exchange('/api/models', 100, {}), exchange('/api/compare', 5010, compare), exchange('/api/judge', 6020, judge)] })
const refused = (input, pattern) => assert.throws(() => buildRecording(input), e => e instanceof RefusedRun && pattern.test(e.message))

test('builds a recording with times relative to the click, dropping calls made before it', () => {
  const rec = buildRecording(base())
  assert.deepEqual(rec.exchanges.map(e => e.path), ['/api/compare', '/api/judge'])
  assert.equal(rec.exchanges[0].t_start, 10)
  assert.equal(rec.exchanges[1].t_end, 2020)
  assert.deepEqual(rec.reported, { model: 'vendor/judge-1', model_role: 'judge', cost_usd: 0.0004, cost_scope: 'judge call' })
  assert.deepEqual(rec.exchanges[0].headers, { 'content-type': 'application/json' })
})

test('refuses a run that errored, did not finish, or got an error status', () => {
  const withChange = (index, change) => ({ ...base(), exchanges: base().exchanges.map((e, i) => (i === index ? { ...e, ...change } : e)) })
  refused(withChange(2, { done: false }), /did not finish/)
  refused(withChange(2, { error: 'TypeError: Failed to fetch' }), /failed/)
  refused(withChange(1, { status: 500 }), /answered 500/)
  refused(withChange(2, { status: 429 }), /answered 429/)
})

test('refuses a run that never reached the judge, or never started', () => {
  refused({ ...base(), exchanges: base().exchanges.slice(0, 2) }, /never reached/)
  refused({ ...base(), t0: null }, /never started/)
  refused({ ...base(), t0: 99999 }, /no request was made/)
})

test('refuses a run whose panels or judge failed, or whose judge reports no model or cost', () => {
  const swap = (path, body) => ({ ...base(), exchanges: base().exchanges.map(e => (e.path === path ? exchange(path, e.t_start, body) : e)) })
  refused(swap('/api/compare', { ...compare, answers: [{ ...compare.answers[0], ok: false }, compare.answers[1]] }), /panel did not answer/)
  refused(swap('/api/compare', { ...compare, blind: false }), /blind answers/)
  refused(swap('/api/judge', { ok: false, reason: 'x' }), /did not give a verdict/)
  refused(swap('/api/judge', { ...judge, model: null }), /no model/)
  refused(swap('/api/judge', { ...judge, cost: null }), /no cost/)
})

test('refuses a body that is not JSON', () => {
  const input = base()
  input.exchanges[2] = exchange('/api/judge', 6020, judge, { chunks: [{ t: 7020, text: '<html>' }] })
  refused(input, /JSON/)
})

const tempDir = files => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'replay-apps-'))
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content))
  return dir
}
const configError = (fn, pattern) => assert.throws(fn, e => e instanceof ConfigError && pattern.test(e.message))

test('app-06 config file carries the values the recorder used to hard-code', () => {
  assert.equal(config.url, 'https://jdgafx-app-06-llm-playground.netlify.app/')
  assert.equal(config.tryButton, 'Try it')
  assert.equal(config.finishPath, '/api/judge')
  assert.equal(config.apiPrefix, '/api/')
  assert.ok(listApps().includes(app))
})

test('loads a config from a directory and lists only valid app names', () => {
  const dir = tempDir({ 'app-x.json': config, 'Bad_Name.json': config, 'notes.txt': 'x' })
  assert.deepEqual(listApps(dir), ['app-x'])
  assert.equal(loadAppConfig('app-x', dir).tryButton, 'Try it')
})

test('refuses an unknown app, a path-like name, bad JSON and a missing field', () => {
  const dir = tempDir({ 'broken.json': '{nope', 'no-url.json': { ...config, url: 'http://insecure/' }, 'no-report.json': { ...config, reported: {} }, 'no-expect.json': { ...config, expect: [{ path: '/api/x', field: 'a' }] } })
  configError(() => loadAppConfig('app-99-nothing', dir), /unknown app/)
  configError(() => loadAppConfig('../lib', dir), /unknown app/)
  configError(() => loadAppConfig(undefined, dir), /unknown app/)
  configError(() => loadAppConfig('broken', dir), /not valid JSON/)
  configError(() => loadAppConfig('no-url', dir), /url must be/)
  configError(() => loadAppConfig('no-report', dir), /reported needs/)
  configError(() => loadAppConfig('no-expect', dir), /expect must list/)
})

test('records every app in order, continues past a failed one and reports it', async () => {
  const seen = []
  const result = await recordApps(['a', 'b', 'c', 'd'], async name => {
    seen.push(name)
    if (name === 'b') throw new Error('boom')
    return name !== 'c'
  })
  assert.deepEqual(seen, ['a', 'b', 'c', 'd'])
  assert.deepEqual(result, { ok: ['a', 'd'], failed: ['b', 'c'] })
  assert.deepEqual(await recordApps([], async () => true), { ok: [], failed: [] })
})

test('a config drives the checks: another app with its own paths and fields is judged by its file', () => {
  const other = { ...config, finishPath: '/api/run', expect: [{ path: '/api/run', field: 'items.*.ok', equals: true }], reported: { model: { path: '/api/run', field: 'meta.model' }, modelRole: 'writer', costUsd: { path: '/api/run', field: 'meta.usd' }, costScope: 'whole run' } }
  const body = { items: [{ ok: true }, { ok: true }], meta: { model: 'v/m', usd: 0.01 } }
  const input = changed => ({ app: 'other', config: other, url: 'https://example.test/', recordedAt: 'x', t0: 1, exchanges: [exchange('/api/run', 10, changed)] })
  assert.deepEqual(buildRecording(input(body)).reported, { model: 'v/m', model_role: 'writer', cost_usd: 0.01, cost_scope: 'whole run' })
  refused(input({ ...body, items: [{ ok: true }, { ok: false }] }), /not as expected/)
  refused(input({ ...body, items: [] }), /not as expected/)
  refused(input({ ...body, meta: { usd: 0.01 } }), /no model/)
})
