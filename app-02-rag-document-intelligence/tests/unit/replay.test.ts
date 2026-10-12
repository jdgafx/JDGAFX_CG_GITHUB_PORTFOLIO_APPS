import { describe, expect, it } from 'vitest'
import { retrieve } from '../../src/lib/bm25'
import { askBody } from '../../src/lib/api'
import { TRY_QUESTION } from '../../src/lib/howto'
import { recordedAsk, recordsThisAsk, replayDisabled } from '../../src/lib/replayCheck'
import type { Recording } from '../../src/replay/recording'
import type { DocumentState } from '../../src/types'

const chunks = [
  'Photosynthesis happens in the chloroplasts of plant cells.',
  'Light reactions in the thylakoid membranes make ATP and oxygen.',
  'The Calvin cycle in the stroma produces sugars.',
  'Unrelated text about rivers.',
]
const doc: DocumentState = { title: 'Photosynthesis', source: { label: 'Wikipedia', url: null }, chunks, chunkPages: [1, 1, 2, 2], unit: 'section', pages: 2, sectionTitles: ['A', 'B'], charCount: 200 }

function recordingWith(body: string | null): Recording {
  return {
    version: 1,
    app: 'app-02-rag-document-intelligence',
    url: 'https://example.test/',
    recorded_at: '2026-10-12T00:00:00.000Z',
    reported: { model: 'm', model_role: 'answered by', cost_usd: 0.1, cost_scope: 'this question' },
    exchanges: [{ method: 'POST', path: '/api/ai', request_body: body, status: 200, headers: {}, t_start: 0, t_headers: 1, t_end: 2, chunks: [] }],
  }
}

describe('replay', () => {
  it('is off only with ?replay=off', () => {
    expect(replayDisabled('?replay=off')).toBe(true)
    expect(replayDisabled('')).toBe(false)
    expect(replayDisabled('?replay=on')).toBe(false)
  })

  it('replays only a recording of the same passages and question', () => {
    const body = askBody(TRY_QUESTION, chunks, doc.title, retrieve(TRY_QUESTION, chunks).ranked)
    expect(recordedAsk(recordingWith(body))).toBe(body)
    expect(recordsThisAsk(recordingWith(body), doc)).toBe(true)
    // An edited article changes the passages the model was sent: the citations would point at the wrong text.
    expect(recordsThisAsk(recordingWith(body), { ...doc, chunks: chunks.map(c => c.replace('chloroplasts', 'plastids')) })).toBe(false)
    expect(recordsThisAsk(recordingWith(null), doc)).toBe(false)
  })
})
