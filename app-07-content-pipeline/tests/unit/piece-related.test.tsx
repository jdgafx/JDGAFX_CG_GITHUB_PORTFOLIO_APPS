import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Piece from '../../src/components/Piece'
import { formatSourcePack, withSources, type SourcePack } from '../../netlify/shared/sourcepack'

const PACK: SourcePack = {
  sources: [
    { n: 1, kind: 'wikipedia', title: 'Unit testing', url: 'https://en.wikipedia.org/wiki/Unit_testing', summary: 'Unit testing is a method of testing units of source code.' },
    { n: 2, kind: 'hackernews', title: 'Multiple assertions are fine in a unit test', url: 'https://news.ycombinator.com/item?id=33478000', summary: '', points: 319, date: '2022-11-05' },
  ],
  notes: [],
}

function pieceHtml(pack: SourcePack): string {
  const polish = withSources('Unit testing checks units of source code [1]. A thread was posted [2].', pack, 'Blog Post')
  return renderToStaticMarkup(
    <Piece
      topic="unit testing"
      outputs={{ sources: formatSourcePack(pack), polish }}
      notes={{}}
      running={false}
      runningStage={null}
      outcome={{ kind: 'complete' }}
      hasCalls
      copyNote=""
      onCopy={() => undefined}
      onContinue={() => undefined}
    />,
  )
}

describe('the finished piece', () => {
  it('shows a Hacker News story as a link in a Related list with its points and date, never as a cited source', () => {
    const html = pieceHtml(PACK)
    expect(html).toContain('Related on Hacker News')
    expect(html).toContain('href="https://news.ycombinator.com/item?id=33478000"')
    expect(html).toContain('Multiple assertions are fine in a unit test')
    expect(html).toContain('319 points, 2022-11-05')
    expect(html).toContain('aria-label="Sources"')
    expect(html).not.toContain('[2]')
    expect(html.match(/ds-cite__n">\[/g)).toHaveLength(1)
  })

  it('says no article was found to cite, and still lists the stories, when only headlines were found', () => {
    const html = pieceHtml({ sources: PACK.sources.slice(1).map(source => ({ ...source, n: 1 })), notes: [] })
    expect(html).toContain('No article was found to cite for this topic')
    expect(html).toContain('Related on Hacker News')
    expect(html).not.toContain('Sources cited')
  })

  it('shows no Related list when no headline-only source was found', () => {
    expect(pieceHtml({ sources: PACK.sources.slice(0, 1), notes: [] })).not.toContain('Related on Hacker News')
  })
})
