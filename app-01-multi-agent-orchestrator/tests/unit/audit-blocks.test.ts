import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../../src/components/Markdown'
import { extractClaims } from '../../src/lib/audit'
import { pendingClaims } from '../../src/lib/auditState'
import type { Source } from '../../src/types'

const SOURCES: Source[] = [{ n: 1, title: 'T', site: 'Wikipedia', url: 'https://x.test', snippet: 'Webb is large. Webb sees infrared light.' }]
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element)

describe('cited sentences outside paragraphs and lists are audited, never skipped', () => {
  const body = ['## Findings about Webb [1]', '', '| Fact | Source |', '| --- | --- |', '| Webb is large [1] | Wikipedia |', '| Plain cell | Webb sees infrared light [1]. It is cold [1]. |', '', '```', 'Webb is a code line [1]', '```', '', 'A paragraph fact [1].'].join('\n')

  it('extracts a heading, each table cell sentence and each code line that carries a marker, in reading order, with where each sits', () => {
    const claims = extractClaims(body)
    expect(claims.map(claim => claim.text)).toEqual(['Findings about Webb [1]', 'Webb is large [1]', 'Webb sees infrared light [1].', 'It is cold [1].', 'Webb is a code line [1]', 'A paragraph fact [1].'])
    expect(claims.map(claim => [claim.id, claim.block, claim.unit ?? 0, claim.piece])).toEqual([
      [1, 0, 0, 0],
      [2, 2, 2, 0],
      [3, 2, 5, 0],
      [4, 2, 5, 1],
      [5, 4, 0, 0],
      [6, 6, 0, 0],
    ])
  })

  it('counts them all in the pending claims the page shows while the audit runs', () => {
    expect(pendingClaims(body, SOURCES)).toHaveLength(6)
  })

  it('shows a badge on a cited heading, on a cited table cell, and on a cited code line', () => {
    const out = html(createElement(Markdown, { text: body, sources: SOURCES, audit: { claims: pendingClaims(body, SOURCES), selected: null, onSelect: () => undefined } }))
    expect(out.match(/class="claim"/g)).toHaveLength(6)
    expect(out).toMatch(/<h4>[^]*class="claim"[^]*<\/h4>/)
    expect(out).toMatch(/<td>[^]*class="claim"[^]*<\/td>/)
    expect(out).toMatch(/<code>[^]*class="claim"[^]*<\/code>/)
  })
})

describe('the preceding sentence as context comes from the same block only', () => {
  it('gives the second sentence of a paragraph the first as context', () => {
    const claims = extractClaims('Cas9 cuts DNA. These programmable molecules make breaks [1].')
    expect(claims[0]?.context).toBe('Cas9 cuts DNA.')
  })

  it('gives the first sentence of a block no context, even when an earlier block exists', () => {
    const claims = extractClaims('First fact is here [1].\n\nSecond block opens here [2]. Then more [3].\n\n- A bullet fact [4].')
    expect(claims.map(claim => claim.context)).toEqual([undefined, undefined, 'Second block opens here.', undefined])
  })

  it('takes context from the same table cell only', () => {
    const claims = extractClaims('| A | B |\n| --- | --- |\n| One fact [1]. | Two facts. More [2]. |')
    expect(claims.map(claim => claim.context)).toEqual([undefined, 'Two facts.'])
  })
})
