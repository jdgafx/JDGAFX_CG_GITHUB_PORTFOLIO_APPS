import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Dock's effects do not run on the server renderer, so the hooks are replaced: useEffect records the
// effect and useRef hands out a button stand-in that counts focus calls.
const focus = vi.hoisted(() => vi.fn())
const effects = vi.hoisted((): Array<() => void> => [])

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useEffect: (effect: () => void) => {
      effects.push(effect)
    },
    useRef: () => ({ current: { focus } }),
  }
})

import Dock from '../../src/components/Dock'

const props = { recording: false, busy: true, hasMic: true, canAsk: true, onFinishRecording: () => undefined, onRecord: () => undefined, onStop: () => undefined }

describe('Dock', () => {
  afterEach(() => {
    focus.mockClear()
    effects.length = 0
  })

  // Enter sends the question; a second quick Enter must not land on Stop and cancel it.
  it('does not move focus to Stop when a run starts', () => {
    renderToStaticMarkup(createElement(Dock, props))
    effects.forEach(effect => effect())
    expect(focus).not.toHaveBeenCalled()
  })

  it('keeps Stop a plain, enabled button that Tab can reach while a run is on', () => {
    const html = renderToStaticMarkup(createElement(Dock, props))
    const stop = html.match(/<button[^>]*>(?:(?!<\/button>).)*Stop<\/button>/)?.[0] ?? ''
    expect(stop).toContain('type="button"')
    expect(stop).not.toContain('disabled')
    expect(stop).not.toContain('tabindex')
  })
})
