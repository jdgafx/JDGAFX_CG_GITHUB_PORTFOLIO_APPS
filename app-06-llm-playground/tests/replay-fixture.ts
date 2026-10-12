import type { Recording } from '../src/replay'

// A recording shaped like a real one (a blind compare, then the judge). The text is invented for the tests only;
// no test ever shows it as a real run.
export const COMPARE_BODY = { blind: true, runId: '1790000000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', expiresAt: '2026-10-12T00:00:00Z', totalMs: 9000, answers: [{ label: 'A', ok: true, error: null, text: 'alpha', finishReason: 'stop' }] }
export const JUDGE_BODY = { ok: true, model: 'anthropic/claude-test', latencyMs: 3000, bestOverall: 'A', perPanel: {}, caveat: '', usage: {}, cost: { usd: 0.000412, source: 'usage' }, trace: [] }
export const COMPARE_REQUEST = JSON.stringify({ prompt: 'p', models: ['m0', 'm1', 'm2'], blind: true })
export const JUDGE_REQUEST = JSON.stringify({ prompt: 'p', answers: [{ slot: 'A', text: 'alpha' }] })

export const NOW = Date.parse('2026-10-12T12:00:00Z')

export function recording(overrides: Partial<Recording> = {}): Recording {
  const compare = JSON.stringify(COMPARE_BODY)
  const half = Math.floor(compare.length / 2)
  return {
    version: 1,
    app: 'app-06-llm-playground',
    url: 'https://example.test/',
    recorded_at: new Date(NOW - 2 * 3_600_000).toISOString(),
    reported: { model: 'anthropic/claude-test', model_role: 'judge', cost_usd: 0.000412, cost_scope: 'judge call' },
    exchanges: [
      {
        method: 'POST',
        path: '/api/compare',
        request_body: COMPARE_REQUEST,
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        t_start: 5,
        t_headers: 4000,
        t_end: 4100,
        chunks: [
          { t: 4000, text: compare.slice(0, half) },
          { t: 4100, text: compare.slice(half) },
        ],
      },
      {
        method: 'POST',
        path: '/api/judge',
        request_body: JUDGE_REQUEST,
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        t_start: 4110,
        t_headers: 7000,
        t_end: 7000,
        chunks: [{ t: 7000, text: JSON.stringify(JUDGE_BODY) }],
      },
    ],
    ...overrides,
  }
}
