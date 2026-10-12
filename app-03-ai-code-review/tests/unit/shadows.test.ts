import { describe, expect, it } from 'vitest'
import { fileDoc } from '../../netlify/shared/anchor'
import { checkClaim } from '../../netlify/shared/typed-claim'

// gorilla/mux v1.8.1 mux.go, lines 521 to 531 (renumbered from 1 here): `err` is declared at the top of the function (line 1 here)
// and declared again inside the loop (line 7 here). Live, the second pass cited both lines and the check said there was "no outer
// declaration of err" because its backward walk started at the smaller cited line, the outer one, and skipped it.
const MUX = [
  'func mapFromPairsToRegex(pairs ...string) (map[string]*regexp.Regexp, error) {',
  '\tlength, err := checkPairs(pairs...)',
  '\tif err != nil {',
  '\t\treturn nil, err',
  '\t}',
  '\tfor i := 0; i < length; i += 2 {',
  '\t\tregex, err := regexp.Compile(pairs[i+1])',
  '\t\tif err != nil {',
  '\t\t\treturn nil, err',
  '\t\t}',
  '\t}',
  '}',
]
const doc = fileDoc(MUX)
const claim = (lines: number[]) => ({ kind: 'shadows' as const, names: ['err'], lines, quote: 'regex, err := regexp.Compile(pairs[i+1])' })
const check = (lines: number[], at = 7) => checkClaim(claim(lines), doc, at, 'length, err := checkPairs(pairs...)')

describe('shadows: the outer declaration may be one of the lines the claim cites', () => {
  it('confirms a claim that cites the shadowing line only (the outer declaration is found above it)', () => {
    expect(check([7])).toBeNull()
  })

  it('confirms a claim that cites the shadowing line and the outer line, in either order', () => {
    expect(check([7, 2])).toBeNull()
    expect(check([2, 7])).toBeNull()
  })

  it('still refuses a name with no outer declaration, however many lines are cited', () => {
    const lone = fileDoc(['func f() {', '\tfor i := 0; i < 3; i++ {', '\t\tregex, err := compile(i)', '\t\t_ = regex', '\t\t_ = err', '\t}', '}'])
    const c = { kind: 'shadows' as const, names: ['err'], lines: [3, 5], quote: 'regex, err := compile(i)' }
    expect(checkClaim(c, lone, 3, 'x')).toMatch(/no import and no outer declaration of err/)
  })

  it('still refuses an outer declaration whose block has closed before the shadowing line', () => {
    const closed = fileDoc(['func f() {', '\tif ok {', '\t\ta, err := first()', '\t\t_ = a', '\t\t_ = err', '\t}', '\tb, err := second()', '\t_ = b', '}'])
    // Line 3's err sits in a block that closed at line 6; line 7 declares a new err in the function body: nothing is shadowed.
    const c = { kind: 'shadows' as const, names: ['err'], lines: [7, 3], quote: 'b, err := second()' }
    expect(checkClaim(c, closed, 7, 'x')).toMatch(/no import and no outer declaration of err/)
  })

  it('refuses a claim whose cited lines declare nothing of that name', () => {
    expect(checkClaim({ ...claim([3]), names: ['err'], quote: 'if err != nil {' }, doc, 3, 'x')).toMatch(/is not declared on the cited line/)
  })
})
