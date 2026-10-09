import { describe, expect, it } from 'vitest'
import { contradictedByScope, importedNames, noneWithoutSource, unconfirmable } from '../../netlify/shared/claims'
import { fileDoc } from '../../netlify/shared/anchor'
import { precheck } from '../../netlify/shared/review'

// express 4.21.2 lib/response.js, the require lines (some of them) and lines 445 and 446, copied verbatim.
const RESPONSE_HEAD = [
  "var escapeHtml = require('escape-html');",
  "var http = require('http');",
  "var isAbsolute = require('./utils').isAbsolute;",
  "var path = require('path');",
  "var send = require('send');",
  "var merge = require('utils-merge');",
  "var sign = require('cookie-signature').sign;",
]
// click 8.1.7 utils.py header and LazyFile.__init__ lines 128 to 138.
const UTILS_HEAD = ['import os', 'import re', 'import typing as t', 'from functools import update_wrapper', 'from ._compat import _default_text_stdout', 'from ._compat import auto_wrap_for_ansi']
const LAZY_INIT = [
  '        if self.name == "-":',
  '            self._f, self.should_close = open_stream(filename, mode, encoding, errors)',
  '        else:',
  '            if "r" in mode:',
  "                # Open and close the file in case we're opening it for",
  '                # reading so that we can catch at least some errors in',
  '                # some cases early.',
  '                open(filename, mode).close()',
  '            self._f = None',
  '            self.should_close = True',
]

describe('importedNames', () => {
  it('reads require and import forms in JavaScript, Python and Go', () => {
    expect([...importedNames(RESPONSE_HEAD)]).toEqual(expect.arrayContaining(['escapeHtml', 'http', 'isAbsolute', 'path', 'send', 'merge', 'sign']))
    expect([...importedNames(UTILS_HEAD)]).toEqual(expect.arrayContaining(['update_wrapper', '_default_text_stdout', 'auto_wrap_for_ansi']))
    const go = ['package mux', '', 'import (', '\t"context"', '\t"errors"', '\t"net/http"', '\tneturl "net/url"', ')']
    expect([...importedNames(go)]).toEqual(expect.arrayContaining(['context', 'errors', 'http', 'neturl']))
  })
})

describe('unconfirmable: claims a single file cannot confirm', () => {
  const imports = importedNames(RESPONSE_HEAD)

  it('does not confirm the live express claim about how send treats ? and # (response.js L445)', () => {
    const message = "encodeURI does not encode characters such as '?' or '#', so a filename containing them is interpreted by send as a query or fragment rather than as part of the path."
    expect(unconfirmable(message, 'var file = send(req, pathname, opts);', imports)).toBe('Not confirmed: the claim rests on how send behaves, and send is not defined in this file.')
  })

  it('does not confirm the live redux claim about where a link points', () => {
    const message = 'The link text is a hardcoded absolute URL that does not match its target, which is a root-relative path to a different location; the target path is unverified.'
    expect(unconfirmable(message, '+  [https://redux.js.org/reselect/](/reselect/) <br/>', new Set())).toBe('Not confirmed: the claim rests on where a link points, which the diff does not show.')
  })

  it('does not confirm a claim that rests on a language version', () => {
    expect(unconfirmable('Python 3 derives __ne__ automatically from __eq__, so defining it is redundant.', 'def __ne__(self, other):', new Set())).toMatch(/language or library version/)
  })

  it('does not confirm a failure that names no path to it (click L191: "after an unexpected path")', () => {
    const message = 'If open() returns but self._f is still None (for example after an unexpected path), iter(None) raises an unhelpful TypeError, and the type: ignore hides the mismatch.'
    expect(unconfirmable(message, 'return iter(self._f)  # type: ignore', new Set())).toBe('Not confirmed: the claim names no path to the failure ("unexpected path"), so there is nothing to check it against.')
  })

  it('does not confirm the live requests#6963 claim about an unset $HOME', () => {
    const message = 'This line can now raise KeyError uncaught when $HOME is unset and the password database lookup fails, which is the exact failure the removed handler protected against.'
    expect(unconfirmable(message, '+            loc = os.path.expanduser(f)', new Set())).toMatch(/process environment/)
  })

  it('lets a claim about the file\'s own code, or about a name (shadowing), through', () => {
    expect(unconfirmable('The unchecked type assertion rv.(map[string]string) panics if another value is stored under varsKey.', 'return rv.(map[string]string)', new Set(['http']))).toBeNull()
    expect(unconfirmable('The local variable path shadows the imported path package and returns confusion.', 'path := req.URL.Path', new Set(['path']))).toBeNull()
  })
})

describe('contradictedByScope: a call the comment says is missing', () => {
  const lines = [...UTILS_HEAD, '', 'class LazyFile:', '    def __init__(self, filename, mode):', ...LAZY_INIT, '', '    def open(self):', '        pass']
  const lineOf = (needle: string) => lines.findIndex((l) => l.includes(needle)) + 1
  const message = "The file is opened without a context manager, relying on the temporary object's refcount for closure, and the encoding/errors arguments are not passed."

  it('finds the close() on the very line a "never closed" comment cites (click L136)', () => {
    expect(contradictedByScope(message, 'Use `with open(filename, mode)`.', lines, lineOf('open(filename, mode).close()'))).toEqual({ what: 'close', at: lineOf('open(filename, mode).close()'), text: 'open(filename, mode).close()' })
  })

  it('drops the second live wording of that comment, which never says "closed" (a bare open() closed on the same line)', () => {
    const second = 'The file is opened with a bare open() call that is never used as a context manager and ignores the encoding and errors arguments, so a file that opens with the given mode but fails to decode is not caught early.'
    const at = lineOf('open(filename, mode).close()')
    expect(contradictedByScope(second, 'Use `with open(filename, mode, encoding=encoding, errors=errors): pass`.', lines, at)).toMatchObject({ what: 'close', at })
  })

  it('finds a close() elsewhere in the same function', () => {
    const fn = ['def read(path):', '    f = open(path)', '    data = f.read()', '    f.close()', '    return data']
    expect(contradictedByScope('The file handle is never closed.', 'Use a with block.', fn, 2)).toMatchObject({ what: 'close', at: 4 })
  })

  it('says nothing when the scope really has no close, or the comment is about something else', () => {
    const leak = ['def read(path):', '    f = open(path)', '    return f.read()']
    expect(contradictedByScope('The file handle is never closed.', 'Use a with block.', leak, 2)).toBeNull()
    expect(contradictedByScope('The loop is slow.', 'Hoist the call.', ['def f():', '    x.close()'], 2)).toBeNull()
  })

  it('is applied by the checks: the comment is dropped with the line that closes the handle', () => {
    const doc = fileDoc(lines)
    const at = lineOf('open(filename, mode).close()')
    const result = precheck([{ line: at, quote: 'open(filename, mode)', severity: 'warning', message, suggestion: 'Use `with open(filename, mode)`.', issue: true }], doc, 15)
    expect(result.candidates).toEqual([])
    expect(result.dropped[0].reason).toBe(`The comment says it is never closed, but the code in its scope does: "open(filename, mode).close()" (line ${at}).`)
  })
})

describe('noneWithoutSource: a None claim needs code that shows a None', () => {
  const live = 'If self._f is still None after open() returns, iter(None) raises a confusing TypeError; the type ignore hides this.'

  it('does not confirm the live click L191 claim backed by `self.open()` or `self._f = rv`', () => {
    for (const support of ['self.open()', 'self._f = rv']) {
      expect(noneWithoutSource(live, support)).toBe('Not confirmed: the claim is that a value is None or null, but the code quoted for it does not show where a None comes from.')
    }
  })

  it('lets it through when the support shows a None, an Optional or a null', () => {
    expect(noneWithoutSource(live, 'self._f: t.Optional[t.IO[t.Any]]')).toBeNull()
    expect(noneWithoutSource('The value is null when the key is missing.', 'return null')).toBeNull()
  })

  it('ignores claims that are not about None', () => {
    expect(noneWithoutSource('The loop allocates on every call.', 'make([]int, 0)')).toBeNull()
  })
})
