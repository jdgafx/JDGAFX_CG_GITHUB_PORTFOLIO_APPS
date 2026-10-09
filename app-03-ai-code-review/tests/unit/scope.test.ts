import { describe, expect, it } from 'vitest'
import { enclosingScope, opensScope, scopeListing, MAX_SCOPE_LINES } from '../../netlify/shared/scope'

// gorilla/mux v1.8.1 mux.go lines 375 to 399 (the walk method), copied verbatim; line 1 here is line 375 there.
const WALK = `func (r *Router) walk(walkFn WalkFunc, ancestors []*Route) error {
	for _, t := range r.routes {
		err := walkFn(t, r, ancestors)
		if err == SkipRouter {
			continue
		}
		if err != nil {
			return err
		}
		for _, sr := range t.matchers {
			if h, ok := sr.(*Router); ok {
				ancestors = append(ancestors, t)
				err := h.walk(walkFn, ancestors)
				if err != nil {
					return err
				}
				ancestors = ancestors[:len(ancestors)-1]
			}
		}
		if h, ok := t.handler.(*Router); ok {
			ancestors = append(ancestors, t)
			err := h.walk(walkFn, ancestors)
			if err != nil {
				return err
			}
			ancestors = ancestors[:len(ancestors)-1]
		}
	}
	return nil
}

func (r *Router) Walk(walkFn WalkFunc) error {
	return r.walk(walkFn, []*Route{})
}`.split('\n')

// click 8.1.7 utils.py: the lazy file wrapper whose open() sets _f or raises, then __iter__ (lines 148 to 192, trimmed).
const LAZY = `class LazyFile:
    def open(self):
        if self._f is not None:
            return self._f
        try:
            rv, self.should_close = open_stream(self.name, self.mode, self.encoding, self.errors, atomic=self.atomic)
        except OSError as e:
            raise FileError(self.name, hint=e.strerror) from e
        self._f = rv
        return rv

    def close(self):
        if self._f is not None:
            self._f.close()

    def __iter__(self):
        self.open()
        return iter(self._f)

def echo(message=None):
    pass`.split('\n')

describe('opensScope', () => {
  it.each(['func (r *Router) walk(w WalkFunc) error {', 'def open(self):', 'class LazyFile:', 'export function f(a) {', 'async def run(self):', 'handleRequest(req, res) {', 'const f = (a, b) => {'])('is true for %j', (l) => expect(opensScope(l)).toBe(true))
  it.each(['if err != nil {', 'for _, t := range r.routes {', 'return iter(self._f)', 'else {', 'while (x) {'])('is false for %j', (l) => expect(opensScope(l)).toBe(false))
})

describe('enclosingScope', () => {
  it('finds a Go method by its braces: the whole walk function for a line in its loop', () => {
    const end = WALK.indexOf('}') + 1
    expect(enclosingScope(WALK, 12)).toEqual({ from: 1, to: end, signature: null, enclosing: true })
  })

  it('stops at the end of the function, not at the next one', () => {
    const end = WALK.indexOf('}') + 1
    expect(enclosingScope(WALK, end - 1).to).toBe(end)
    const walkExported = WALK.findIndex((l) => l.startsWith('func (r *Router) Walk')) + 1
    expect(enclosingScope(WALK, walkExported + 1)).toMatchObject({ from: walkExported, to: WALK.length })
  })

  it('finds a Python method by its indentation, and includes the open() that the comment on __iter__ needs', () => {
    const iter = LAZY.findIndex((l) => l.includes('def __iter__')) + 1
    expect(enclosingScope(LAZY, iter + 2)).toMatchObject({ from: iter, to: iter + 2, enclosing: true })
    // The claim "_f may be None" needs open(), which is a sibling: the class is the next scope up for a line in open().
    const open = LAZY.findIndex((l) => l.includes('def open')) + 1
    expect(enclosingScope(LAZY, open + 4)).toMatchObject({ from: open, to: open + 8 })
  })

  it('uses a window of 20 lines either side for top-level code', () => {
    const flat = Array.from({ length: 100 }, (_, i) => `x${i} = ${i}`)
    expect(enclosingScope(flat, 50)).toEqual({ from: 30, to: 70, signature: null, enclosing: false })
  })

  it('cuts a very long function around the cited line and keeps its signature', () => {
    const body = Array.from({ length: 200 }, (_, i) => `\tstep${i + 1}()`)
    const fn = ['func big() {', ...body, '}']
    const s = enclosingScope(fn, 100)
    expect(s.signature).toBe(1)
    expect(s.to - s.from + 2).toBeLessThanOrEqual(MAX_SCOPE_LINES)
    expect(s.from).toBeLessThanOrEqual(100)
    expect(s.to).toBeGreaterThanOrEqual(100)
  })
})

describe('scopeListing', () => {
  it('prints numbered lines in the listing form, with a gap marker when the signature is far above', () => {
    const body = Array.from({ length: 200 }, (_, i) => `\tstep${i + 1}()`)
    const fn = ['func big() {', ...body, '}']
    const listing = scopeListing(fn, fn, 100).split('\n')
    expect(listing[0]).toBe('1\t| func big() {')
    expect(listing[1]).toBe('...')
    expect(listing).toContain('100\t|' + ' \tstep99()')
  })
})
