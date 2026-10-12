import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRecording, RefusedRun } from './lib.mjs'

const app = 'app-06-llm-playground'
const compare = { blind: true, runId: 'r', answers: [{ label: 'A', ok: true, text: 'a' }, { label: 'B', ok: true, text: 'b' }, { label: 'C', ok: true, text: 'c' }] }
const judge = { ok: true, model: 'vendor/judge-1', cost: { usd: 0.0004, source: 'usage' } }
const json = (t, body) => ({ t, text: JSON.stringify(body) })
const exchange = (path, t, body, change = {}) => ({
  method: 'POST', path, request_body: '{}', status: 200, headers: [['Content-Type', 'application/json'], ['Set-Cookie', 'x=1']],
  t_start: t, t_headers: t + 1000, t_end: t + 1000, chunks: [json(t + 1000, body)], done: true, error: null, ...change,
})
const base = () => ({ app, url: 'https://example.test/', recordedAt: '2026-10-12T00:00:00.000Z', t0: 5000, exchanges: [exchange('/api/models', 100, {}), exchange('/api/compare', 5010, compare), exchange('/api/judge', 6020, judge)] })
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
