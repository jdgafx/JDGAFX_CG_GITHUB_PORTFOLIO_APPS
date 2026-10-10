import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import HowTo from '../../src/components/HowTo'
import { readyToRun, sameSelection, startTry, TRY_IT } from '../../src/lib/tryIt'

const render = (props: Partial<Parameters<typeof HowTo>[0]> = {}) =>
  renderToStaticMarkup(createElement(HowTo, { open: true, onToggle: () => undefined, onTry: () => undefined, busy: false, ...props }))

/** Finds the first element in a React tree for which `match` is true. */
function find(node: unknown, match: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | null {
  if (!node || typeof node !== 'object') return null
  const element = node as ReactElement<Record<string, unknown>>
  if (element.props && match(element)) return element
  const children = element.props?.children
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = find(child, match)
    if (found) return found
  }
  return null
}

describe('the How to use block', () => {
  it('has a heading, an ordered list of one to four steps that name the real controls, and a Try it button', () => {
    const html = render()
    expect(html).toContain('<h2')
    expect(html).toContain('How to use')
    const steps = [...html.matchAll(/<li>/g)]
    expect(steps.length).toBeGreaterThanOrEqual(1)
    expect(steps.length).toBeLessThanOrEqual(4)
    expect(html).toContain('<ol')
    // The labels are the ones on screen.
    for (const label of ['Add a package', 'Ready-made comparisons', 'Explain spikes']) expect(html).toContain(label)
    expect(html).toMatch(/<button[^>]*class="ds-button ds-button--primary[^"]*"[^>]*>Try it<\/button>/)
    expect(html).toContain('aria-labelledby="howto-title"')
  })

  it('is open or closed as told, and the Try it button is disabled while a run is going', () => {
    expect(render({ open: true })).toMatch(/<details[^>]* open/)
    expect(render({ open: false })).not.toMatch(/<details[^>]* open/)
    expect(render({ busy: true })).toMatch(/<button[^>]*disabled[^>]*>Try it/)
    expect(render({ busy: false })).not.toMatch(/<button[^>]*disabled[^>]*>Try it/)
  })

  it('says what the app does in at most 15 words, and never calls anything demo or sample data', () => {
    const html = render()
    const line = /howto__line">([^<]+)</.exec(html)?.[1] ?? ''
    expect(line.split(/\s+/).length).toBeLessThanOrEqual(15)
    expect(html).not.toMatch(/\b(?:demo|sample data)\b/i)
  })

  it('calls onTry when the Try it button is pressed', () => {
    const onTry = vi.fn()
    const tree = HowTo({ open: true, onToggle: () => undefined, onTry, busy: false })
    const button = find(tree, (e) => e.type === 'button')
    expect(button).not.toBeNull()
    ;(button?.props.onClick as () => void)()
    expect(onTry).toHaveBeenCalledOnce()
  })
})

describe('Try it', () => {
  it('loads the example selection (four real packages over a year) and queues a run', () => {
    const setNames = vi.fn()
    const setDays = vi.fn()
    const queueRun = vi.fn()
    startTry({ setNames, setDays, queueRun })
    expect(setNames).toHaveBeenCalledWith(['react', 'vite', 'zod', '@anthropic-ai/sdk'])
    expect(setDays).toHaveBeenCalledWith(365)
    expect(queueRun).toHaveBeenCalledOnce()
  })

  it('starts the run only once the selection is the example and the live data is ready', () => {
    expect(readyToRun(true, true)).toBe(true)
    expect(readyToRun(true, false)).toBe(false) // the downloads or the release history are still loading
    expect(readyToRun(false, true)).toBe(false) // nothing queued
    expect(sameSelection([...TRY_IT.names], 365)).toBe(true)
    expect(sameSelection([...TRY_IT.names], 30)).toBe(false)
    expect(sameSelection(['react'], 365)).toBe(false)
  })

  it('has no stored result: the example is only an input', () => {
    expect(Object.keys(TRY_IT).sort()).toEqual(['days', 'names'])
  })
})
