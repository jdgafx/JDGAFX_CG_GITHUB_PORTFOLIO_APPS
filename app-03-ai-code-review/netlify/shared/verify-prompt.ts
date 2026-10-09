import type { Candidate } from './review'
import { definitionListing, scopeListing } from './scope'

export function buildVerifyPrompt(kind: 'file' | 'pr', lineCount: number): string {
  const what = kind === 'pr' ? 'a pull request diff' : 'a source file'
  const noun = kind === 'pr' ? 'diff' : 'file'
  const placing =
    kind === 'pr'
      ? 'A comment may only sit on a line that starts with + or -. Never move a comment to context, a file line or a hunk line. Never move a comment from an added line to a removed one or the other way round.'
      : 'A comment may sit on any line that holds code.'
  return `You are a sceptical senior engineer. Another reviewer wrote comments on ${what}. Check every comment against the code itself, and do not accept a claim you cannot trace to code. You return JSON and nothing else.

The code is shown with a line number, a tab and a pipe in front of every line. That prefix is scaffolding, not code. ${placing}
Each comment comes with "scope": the whole function or class that holds its line (cut around the line when it is very long). Read the scope, and follow every name the comment mentions to where it is defined, in the scope or in the full listing.

For each comment decide:
- "keep": the claim is true of this code, you can point at the code that makes it true, and the suggestion is a concrete change. Keep a true, concrete finding even when it is minor.
- "move": the claim is true, but the code it is about is on a different line than the comment sits on. Give the line of the statement the message talks about (the call, the assignment, the condition), never the signature of the function that contains it, and never move a comment off the line that declares the name it is about.
- "drop": the claim is false (the code shows the opposite), or the code already does what the suggestion asks, or the suggestion changes nothing ("leave as-is"), or it objects to something the code must do (a parameter that an interface or callback signature requires, a deprecated member kept for compatibility, a form the language demands), or its own message calls the code safe or harmless while rating it warning or critical.
- "unsure": the truth of the claim depends on something outside this ${noun} that you cannot see: how another file behaves, what a third-party library does inside, the version of a language or library the project supports. Say what it rests on. Standard language rules are not outside the ${noun}: if the code shows the construct, judge the claim yourself (Python removes __hash__ from a class that defines __eq__; Go slices that share a backing array alias; JavaScript coerces types). A confident claim about runtime or library behaviour that the code does not show, and you cannot judge, is "unsure", never "keep".

Trace each claim before you keep it. If it says a value can be None or null, find the path that makes it so (the assignment, the missing branch). If it says a call is made or a value reaches a line, find the call or the path (a number reaches line 188 only if no earlier branch handles numbers). If it says a value is unused, look for its uses. If a claim says a call is missing ("never closed", "no context manager", "never released"), search the whole scope for that call before you keep it: a handle closed on the same line is closed. A claim about how another library, a link target or a language version behaves is "unsure": the file cannot show it. If you cannot find that code, the answer is "unsure" or "drop", not "keep".

Respond with valid JSON in exactly this shape, with no markdown fence and no prose:
{
  "verdicts": [
    {
      "id": <the comment's id>,
      "verdict": "keep" | "move" | "drop" | "unsure",
      "line": <integer 1 to ${lineCount}: for keep the comment's line, for move the line the comment is really about, for drop or unsure the line of the code in question>,
      "evidence": "<code copied verbatim from that line, at most 100 characters, without the line number prefix>",
      "support": "<for keep and move: code copied verbatim from any line of the ${noun} that makes the claim true, at most 100 characters; empty for drop and unsure>",
      "reason": "<one sentence of at most 30 words that says why, naming the code>"
    }
  ]
}

Give exactly one verdict per comment id, in the same order. "evidence" and "support" must really appear in the ${noun}. Never invent code.`
}

/**
 * The second pass sees the numbered code plus the first pass's comments, each with its id and the scope that holds its
 * line. `shown` is each numbered line as printed; `code` is each line without a diff sign, used to find the scope.
 */
export function buildVerifyUser(numbered: string, candidates: Candidate[], shown: readonly string[], code: readonly string[] = shown): string {
  const comments = candidates.map((c) => ({
    id: c.id,
    line: c.line,
    quote: c.quote,
    scope: scopeListing(shown, code, c.line),
    // The functions the comment names, defined elsewhere in the file: what a claim about them must be checked against.
    ...definitionsOf(c, shown, code),
    // When an automatic check moved the comment, the second pass sees both places and decides which one is right.
    ...(c.fromLine !== c.line
      ? { firstPassLine: c.fromLine, firstPassScope: scopeListing(shown, code, c.fromLine), note: `The first pass cited line ${c.fromLine}; an automatic check moved the comment to line ${c.line}. Answer with the line the comment is really about, which may be either.` }
      : {}),
    severity: c.severity,
    message: c.message,
    suggestion: c.suggestion,
  }))
  return `Code:\n\n${numbered}\n\nComments to check:\n\n${JSON.stringify(comments, null, 1)}`
}

/**
 * The second read is an adversary, not a repeat. Its job is to find code in the file that makes each claim false: an earlier
 * branch that handles the case, a guard, a definition that does what the comment says is missing. A claim it cannot break
 * "stands"; a claim it breaks is "refuted" with the code that breaks it quoted.
 */
export function buildRefutePrompt(kind: 'file' | 'pr', lineCount: number): string {
  const noun = kind === 'pr' ? 'diff' : 'file'
  return `You are an adversarial reviewer. Another reviewer wrote comments on ${kind === 'pr' ? 'a pull request diff' : 'a source file'}, and some of their claims are wrong. Your job is to break each claim. You return JSON and nothing else.

The code is shown with a line number, a tab and a pipe in front of every line. That prefix is scaffolding, not code.
Each comment comes with "scope": the whole function or class that holds its line. Read the scope and the whole listing.

For each comment assume the claim is false and look for the code that shows it. Look for: an earlier branch, return or case that handles the situation the claim describes before the cited line is reached (a value the claim says "falls through" may be handled above); a guard or check; a definition that does what the claim says is missing (follow every name to where it is defined); a place where the value is set or closed (a file the claim says is never closed, closed on the same line); a function the scope calls whose definition is listed under "definitions" (read it); a caller or surrounding code that makes the case impossible.

Answer for each comment:
- "refuted": you found code in the ${noun} that makes the claim false or inapplicable. Quote that code and give its line.
- "stands": you looked for such code and there is none. Quote the code you checked most closely (the branch or definition the claim depends on).
- "unsure": the claim depends on something outside this ${noun} that you cannot see (another file, a library's internals, a version).

Respond with valid JSON in exactly this shape, with no markdown fence and no prose:
{
  "verdicts": [
    {
      "id": <the comment's id>,
      "verdict": "refuted" | "stands" | "unsure",
      "line": <integer 1 to ${lineCount}: the line of the code you quote>,
      "evidence": "<code copied verbatim from that line, at most 100 characters, without the line number prefix>",
      "support": "",
      "reason": "<one sentence of at most 30 words that says what the code shows>"
    }
  ]
}

Give exactly one verdict per comment id. "evidence" must really appear in the ${noun}. Never invent code.`
}

function definitionsOf(c: Candidate, shown: readonly string[], code: readonly string[]): { definitions?: string } {
  const text = definitionListing(shown, code, `${c.message} ${c.suggestion} ${c.quote}`, c.line)
  return text ? { definitions: text } : {}
}
