import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Hero from '../../src/components/Hero'

describe('Hero empty state', () => {
  it('offers Choose file as a real button, which a keyboard reaches and Enter or Space activates', () => {
    const html = renderToStaticMarkup(
      createElement(Hero, {
        mode: 'describe',
        status: 'idle',
        a: null,
        b: null,
        regions: [],
        activeRegion: null,
        draft: null,
        result: '',
        truncated: false,
        notice: '',
        hidePictures: false,
        onDraft: () => undefined,
        onStart: () => undefined,
        onZoom: () => undefined,
        onRetry: () => undefined,
      }),
    )
    expect(html).toMatch(/<button type="button" class="ds-button ds-button--primary"[^>]*>Choose file<\/button>/)
    expect(html).not.toContain('<label')
    expect(html).not.toContain('tabindex="-1"><label')
  })
})
