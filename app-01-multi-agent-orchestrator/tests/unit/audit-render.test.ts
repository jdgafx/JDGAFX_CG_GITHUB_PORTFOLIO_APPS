import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AuditSummary } from '../../src/components/AuditSummary'
import { Markdown } from '../../src/components/Markdown'
import { ReportCard } from '../../src/components/ReportCard'
import { SourcePanel } from '../../src/components/SourcePanel'
import { createAgents } from '../../src/lib/agents'
import { settleClaim, summarize } from '../../src/lib/audit'
import { IDLE_AUDIT, giveUp, pendingClaims, type AuditView } from '../../src/lib/auditState'
import type { AuditClaim, Source } from '../../src/types'

const JWST = 'The James Webb Space Telescope (JWST) is a space telescope designed to conduct infrared astronomy. It launched on 25 December 2021.'
const SOURCES: Source[] = [{ n: 1, title: 'James Webb Space Telescope', site: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/James_Webb_Space_Telescope', snippet: JWST }]
const REPORT = ['## Findings', 'JWST is designed for infrared astronomy [1]. This is not cited. It launched on 25 December 2021 [1].', '', '### Sources', '', '1. [JWST](https://x.test) - Wikipedia'].join('\n')

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element)

function settled(): AuditClaim[] {
  const pending = pendingClaims(REPORT, SOURCES)
  return pending.map((claim, i) =>
    settleClaim(claim, claim.pre, SOURCES, {
      id: claim.id,
      verdict: i === 0 ? 'supported' : 'unsupported',
      source: 1,
      ...(i === 0 ? { quote: 'designed to conduct infrared astronomy' } : {}),
      reason: i === 0 ? 'Stated.' : 'Not stated.',
    }),
  )
}

function viewOf(claims: AuditClaim[], phase: AuditView['phase'] = 'done'): AuditView {
  return { phase, claims, summary: summarize(claims) }
}

describe('report with claims', () => {
  it('badges each cited sentence with its verdict and leaves the uncited sentence plain', () => {
    const claims = settled()
    const out = html(createElement(Markdown, { text: 'JWST is designed for infrared astronomy [1]. This is not cited. It launched on 25 December 2021 [1].', sources: SOURCES, audit: { claims: claims.map(c => ({ ...c, block: 0, piece: c.id - 1 })).map((c, i) => (i === 1 ? { ...c, piece: 2 } : c)), selected: null, onSelect: () => undefined } }))
    expect(out.match(/class="claim"/g)).toHaveLength(2)
    expect(out).toContain('data-verdict="supported"')
    expect(out).toContain('data-verdict="unsupported"')
    expect(out).toContain('>Supported<')
    expect(out).toContain('>Not supported<')
    expect(out).toContain('This is not cited.')
    expect(out).toContain('Claim 1, Supported. JWST is designed for infrared astronomy. Opens its source.')
    expect(out).toContain('role="button"')
    expect(out).toContain('aria-pressed="false"')
  })

  it('marks the selected claim', () => {
    const claims = pendingClaims(REPORT, SOURCES).map(claim => ({ ...claim, block: 0, piece: 0 })).slice(0, 1)
    const out = html(createElement(Markdown, { text: 'JWST is designed for infrared astronomy [1].', audit: { claims, selected: claims[0]?.id ?? null, onSelect: () => undefined } }))
    expect(out).toContain('data-selected="true"')
    expect(out).toContain('aria-pressed="true"')
    expect(out).toContain('>Checking<')
  })

  it('links a [n] marker to its source outside the audit, and as plain text inside a claim', () => {
    expect(html(createElement(Markdown, { text: 'Fact [1].', sources: SOURCES }))).toContain('href="https://en.wikipedia.org/wiki/James_Webb_Space_Telescope"')
    const claims = pendingClaims('Fact about the telescope [1].', SOURCES)
    const inside = html(createElement(Markdown, { text: 'Fact about the telescope [1].', sources: SOURCES, audit: { claims, selected: null, onSelect: () => undefined } }))
    expect(inside).not.toContain('<a ')
  })
})

describe('AuditSummary states', () => {
  const noop = () => undefined
  it('renders nothing before a report, and a note when there is nothing to check', () => {
    expect(html(createElement(AuditSummary, { view: IDLE_AUDIT, onRetry: noop }))).toBe('')
    expect(html(createElement(AuditSummary, { view: { ...IDLE_AUDIT, phase: 'none', note: 'The report cites no source, so there is nothing to check.' }, onRetry: noop }))).toContain('nothing to check')
  })

  it('says "Auditing N cited claims" while the request is out', () => {
    const out = html(createElement(AuditSummary, { view: viewOf(pendingClaims(REPORT, SOURCES), 'running'), onRetry: noop }))
    expect(out).toContain('Auditing 2')
    expect(out).toContain('audit-bar--pending')
  })

  it('shows the headline, the bar and the legend with counts when done', () => {
    const out = html(createElement(AuditSummary, { view: viewOf(settled()), onRetry: noop }))
    expect(out).toContain('1 of 2 cited claims supported')
    expect(out).toContain('1 not supported.')
    expect(out).toContain('aria-label="Audit result: 1 supported, 1 not supported"')
    expect(out).toContain('data-zero="true"')
    expect(out).toContain('<span class="ds-num">1</span> supported')
  })

  it('names a failed audit, keeps the sentences listed as not checked, and offers a retry', () => {
    const failed = giveUp(viewOf(pendingClaims(REPORT, SOURCES), 'running'), 'failed', 'The AI provider did not answer in time.')
    expect(failed.claims.every(claim => claim.verdict === 'unchecked')).toBe(true)
    const out = html(createElement(AuditSummary, { view: failed, onRetry: () => undefined }))
    expect(out).toContain('Audit did not finish')
    expect(out).toContain('The AI provider did not answer in time.')
    expect(out).toContain('2 cited sentences are listed as not checked')
    expect(out).toContain('Try the audit again')
    expect(html(createElement(AuditSummary, { view: giveUp(failed, 'stopped'), onRetry: noop }))).toContain('Audit stopped')
  })
})

describe('SourcePanel', () => {
  it('marks the verified quote in the cited source', () => {
    const [first] = settled()
    const out = html(createElement(SourcePanel, { claim: first as AuditClaim, sources: SOURCES }))
    expect(out).toContain('<mark class="quote">designed to conduct infrared astronomy</mark>')
    expect(out).toContain('Supported')
    expect(out).toContain('Words shared')
  })

  it('says no sentence backs an unsupported claim and shows the extract unmarked', () => {
    const second = settled()[1]
    const out = html(createElement(SourcePanel, { claim: second as AuditClaim, sources: SOURCES }))
    expect(out).toContain('No sentence of the cited source backs this claim')
    expect(out).not.toContain('<mark')
  })
})

describe('ReportCard states', () => {
  const base = { sources: SOURCES, error: null, hasSteps: false, audit: IDLE_AUDIT, onRetryRun: () => undefined, onRetryAudit: () => undefined }
  const agent = createAgents().synthesizer
  const card = (phase: 'ready' | 'running' | 'failed' | 'stopped' | 'complete', extra: Record<string, unknown> = {}) =>
    html(createElement(ReportCard, { ...base, phase, synthesizer: agent, ...extra }))

  it('shows an empty, a loading, a failed and a stopped state before there is a report', () => {
    expect(card('ready')).toContain('ds-state--empty')
    expect(card('running')).toContain('ds-state--loading')
    expect(card('failed', { error: 'The AI provider did not answer in time.' })).toContain('Try again')
    const stopped = card('stopped', { hasSteps: true })
    expect(stopped).toContain('ds-state--stopped')
    expect(stopped).toContain('Start again')
  })

  it('puts the result heading where the focus hook looks for it', () => {
    const claims = settled()
    const out = card('complete', { synthesizer: { ...agent, output: REPORT, status: 'complete' }, audit: { ...viewOf(claims), result: { claims, summary: summarize(claims), overLimit: 0, usage: {}, ms: 3200, model: 'anthropic/claude-haiku-5.5' } } })
    expect(out).toContain('data-result-focus')
    expect(out).toContain('1 of 2 cited claims supported')
    expect(out).toContain('Audited by claude-haiku-5.5 in 3,200 ms')
    expect(out).not.toContain('class="panel')
    expect(out).not.toContain('data-open')
    expect(out).not.toContain('### Sources')
  })
})

describe('report headings', () => {
  it('shows a Title Case heading in sentence case and keeps the names the sources carry', () => {
    const rust: Source = { n: 1, title: 'Rust (programming language)', site: 'Wikipedia', url: 'https://x.test', snippet: 'Rust is a language. Many teams now write Rust for systems work.' }
    const out = html(createElement(Markdown, { text: '## Why Developers Are Adopting Rust for Systems Programming', sources: [rust] }))
    expect(out).toContain('Why developers are adopting Rust for systems programming')
  })

  it('lowercases a common word that only opens a source title', () => {
    const titanic: Source = { n: 1, title: 'Did the Titanic sink because of an optical illusion?', site: 'Wikipedia', url: 'https://x.test', snippet: 'The Titanic struck an iceberg.' }
    const python: Source = { n: 1, title: 'History of Python', site: 'Wikipedia', url: 'https://x.test', snippet: 'Guido van Rossum began work on Python in 1989.' }
    expect(html(createElement(Markdown, { text: '## Why Did the Titanic Sink?', sources: [titanic] }))).toContain('Why did the Titanic sink?')
    expect(html(createElement(Markdown, { text: '## The History of the Python Programming Language', sources: [python] }))).toContain('The history of the Python programming language')
  })

  it('keeps Tower in a proper name a snippet capitalises mid-sentence', () => {
    const eiffel: Source = { n: 1, title: 'Eiffel Tower', site: 'Wikipedia', url: 'https://x.test', snippet: 'The Eiffel Tower is a lattice tower in Paris.' }
    expect(html(createElement(Markdown, { text: '## History of the Eiffel Tower', sources: [eiffel] }))).toContain('History of the Eiffel Tower')
  })

  it('ignores the capitals of a title a snippet repeats, and keeps names a snippet capitalises', () => {
    const hn: Source = { n: 1, title: 'Largest Volcanic Eruption in Recorded History', site: 'Hacker News', url: 'https://x.test', snippet: 'Hacker News story "Largest Volcanic Eruption in Recorded History", linking to x.test. 38 points.' }
    const everest: Source = { n: 2, title: 'Everest', site: 'Wikipedia', url: 'https://x.test', snippet: 'The tallest peak is Mount Everest in the Himalayas.' }
    expect(html(createElement(Markdown, { text: '## Largest Volcanic Eruption in Recorded History', sources: [hn] }))).toContain('Largest volcanic eruption in recorded history')
    expect(html(createElement(Markdown, { text: '## The Tallest Mountain in the World: Mount Everest', sources: [everest] }))).toContain('The tallest mountain in the world: Mount Everest')
  })

  it('lowers a common word a snippet capitalises only inside a proper name, but keeps a name', () => {
    const crash: Source = { n: 1, title: 'Wall Street crash of 1929', site: 'Wikipedia', url: 'https://x.test', snippet: 'It hit the New York Stock Exchange. Also known as the Great Crash. A stock market crash is a drop.' }
    expect(html(createElement(Markdown, { text: '## What Caused the 1929 Stock Market Crash?', sources: [crash] }))).toContain('What caused the 1929 stock market crash?')
    expect(html(createElement(Markdown, { text: '## Wall Street in 1929', sources: [crash] }))).toContain('Wall Street in 1929')
  })

  it('collapses the double full stop an abbreviation leaves in a claim label', () => {
    const claim: AuditClaim = { id: 1, block: 0, piece: 0, text: 'It struck at 5:12 a.m. [1].', cites: [1], pre: { overlap: 1, best: 1, missingNumbers: [], missingNames: [], level: 'ok' }, verdict: 'supported', reason: 'ok' }
    const out = html(createElement(Markdown, { text: 'It struck at 5:12 a.m. [1].', audit: { claims: [claim], selected: null, onSelect: () => undefined } }))
    expect(out).toContain('It struck at 5:12 a.m. Opens its source.')
    expect(out).not.toContain('a.m.. Opens')
  })
})

describe('report headings with casual Hacker News titles', () => {
  it('keeps both capitals of a name a Wikipedia source writes and a Hacker News title writes in lower case', () => {
    const wiki: Source = { n: 1, title: 'Black Death', site: 'Wikipedia', url: 'https://x.test', snippet: 'The Black Death was a plague pandemic in Europe.' }
    const hn: Source = { n: 2, title: 'Did the black death rampage across the world?', site: 'Hacker News', url: 'https://x.test', snippet: 'Hacker News story.' }
    expect(html(createElement(Markdown, { text: '## How Did the Black Death Spread Across Europe?', sources: [wiki, hn] }))).toContain('How did the Black Death spread across Europe?')
  })
})
