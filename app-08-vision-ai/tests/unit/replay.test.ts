import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReplayLabel } from '../../src/components/ReplayLabel'
import { recordedPicture, REPLAY_URL, replayDisabled, sameRequest } from '../../src/lib/useReplay'
import { isStale, parseRecording } from '../../src/replay'
import { analysisRecording, CREDIT, PICTURE_B64, PICTURE_BYTES, requestBody } from '../helpers/recording'

const parsed = (over: Record<string, unknown> = {}) => parseRecording(analysisRecording(over))!
const withBody = (body: string | null) => {
  const rec = analysisRecording()
  rec.exchanges[0].request_body = body
  return parseRecording(rec)!
}

describe('the stored recording of the example', () => {
  it("is read from this app's own file on the replays branch", () => {
    expect(REPLAY_URL).toBe('https://raw.githubusercontent.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/replays/app-08-vision-ai.json')
  })

  it('is never replayed when malformed or older than three days', () => {
    expect(parseRecording({ version: 1 })).toBeNull()
    expect(parseRecording(analysisRecording({ exchanges: [] }))).toBeNull()
    const old = parsed({ recorded_at: new Date(Date.now() - 4 * 86_400_000).toISOString() })
    expect(isStale(old, Date.now())).toBe(true)
    expect(isStale(parsed(), Date.now())).toBe(false)
  })

  it('is switched off by ?replay=off, which the recorder uses', () => {
    expect(replayDisabled('?replay=off')).toBe(true)
    expect(replayDisabled('')).toBe(false)
    expect(replayDisabled('?replay=on')).toBe(false)
  })
})

describe('the picture a recording carries', () => {
  it('is rebuilt byte for byte from the image in its request, with the credit that came with it', async () => {
    const picture = recordedPicture(parsed())!
    expect(picture.file.type).toBe('image/jpeg')
    expect(picture.file.name).toBe('Street_scene.jpg')
    expect(Buffer.from(await picture.file.arrayBuffer()).toString()).toBe(PICTURE_BYTES)
    expect(picture.credit).toEqual(CREDIT)
  })

  it('has no credit, and a plain name, when the request carried none or an unsafe one', () => {
    for (const body of [requestBody({ credit: undefined }), requestBody({ credit: { ...CREDIT, pageUrl: 'https://evil.example/x' } })]) {
      const picture = recordedPicture(withBody(body))!
      expect(picture.credit).toBeNull()
      expect(picture.file.name).toBe('recorded-picture.jpeg')
    }
  })

  it('is absent when the request is not a whole-picture Describe the page could send again', () => {
    const bad = [
      null,
      'not json',
      '[]',
      requestBody({ mode: 'compare', image2: PICTURE_B64, mediaType2: 'image/jpeg' }),
      requestBody({ mode: 'qa', question: 'What is it?' }),
      requestBody({ image: 'not base64!' }),
      requestBody({ image: undefined }),
      requestBody({ mediaType: 'image/svg+xml' }),
      requestBody({ image: Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64') }),
    ]
    for (const body of bad) expect(recordedPicture(withBody(body)), String(body).slice(0, 40)).toBeNull()
  })
})

describe('which request a recording answers', () => {
  it('matches the same picture, type, mode and question whatever the key order or credit', () => {
    const recorded = requestBody()
    const reordered = JSON.stringify({ credit: null, mode: 'describe', mediaType: 'image/jpeg', image: PICTURE_B64 })
    expect(sameRequest(recorded, recorded)).toBe(true)
    expect(sameRequest(recorded, reordered)).toBe(true)
  })

  it('refuses another picture, another mode, a question the recording lacks, and anything unreadable', () => {
    const recorded = requestBody()
    expect(sameRequest(recorded, requestBody({ image: 'AAAA' }))).toBe(false)
    expect(sameRequest(recorded, requestBody({ mode: 'analyze' }))).toBe(false)
    expect(sameRequest(recorded, requestBody({ question: 'Is it raining?' }))).toBe(false)
    expect(sameRequest(recorded, 'nope')).toBe(false)
    expect(sameRequest(recorded, null)).toBe(false)
    expect(sameRequest(null, null)).toBe(true)
  })
})

describe('the replay label', () => {
  const html = (disabled: boolean) => renderToStaticMarkup(createElement(ReplayLabel, { info: { recording: parsed(), speed: 1, startedAt: Date.now() }, onRunLive: () => undefined, disabled }))

  it('says it is a recording, with the age, model and cost the recording reports', () => {
    const out = html(false)
    expect(out).toContain('Replay of a real run')
    expect(out).toContain('just now')
    expect(out).toContain('described by anthropic/claude-haiku-5.5')
    expect(out).toContain('model call $0.000400')
    expect(out).toMatch(/<button[^>]*>Run it live<\/button>/)
  })

  it('keeps Run it live off while the recording is still playing', () => {
    expect(html(true)).toMatch(/<button[^>]*disabled=""[^>]*>Run it live<\/button>/)
    expect(html(false)).not.toMatch(/disabled/)
  })
})

describe('the status dot inside a badge', () => {
  it('only follows the badge text when it has no state of its own', () => {
    const css = readFileSync('src/styles/tokens.css', 'utf8')
    expect(css).toContain('.ds-badge .ds-dot:not([class*="ds-dot--"]) { background: currentColor; }')
    expect(css).not.toMatch(/\.ds-badge \.ds-dot \{ background: currentColor; \}/)
  })
})
