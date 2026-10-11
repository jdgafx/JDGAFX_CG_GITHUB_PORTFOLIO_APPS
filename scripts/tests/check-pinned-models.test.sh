#!/usr/bin/env bash
# Runs scripts/check-pinned-models.sh against a throwaway tree, one case per rule.
set -euo pipefail

checker=$(cd "$(dirname "$0")/.." && pwd)/check-pinned-models.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
pass=0
fail=0

put() { mkdir -p "$(dirname "$tmp/$1")"; printf '%s\n' "$2" >"$tmp/$1"; }

# expect <name> <want-exit> <want-text or ""> <scan path>...
expect() {
  local name=$1 want_rc=$2 want_text=$3 out rc=0
  shift 3
  out=$(PINNED_ROOT="$tmp" bash "$checker" "$@" 2>&1) || rc=$?
  if [[ $rc -eq $want_rc && ( -z $want_text || $out == *"$want_text"* ) ]]; then
    echo "ok   - $name"
    pass=$((pass + 1))
  else
    echo "FAIL - $name (exit $rc, want $want_rc)"
    sed 's/^/     /' <<<"$out"
    fail=$((fail + 1))
  fi
}

put app-01-alias/src/call.ts "export const MODEL = '~anthropic/claude-haiku-latest'"
put app-02-pinned/src/model.ts "export const MODEL = 'anthropic/claude-haiku-5.5'"
put app-03-comments/src/notes.ts "$(printf '%s\n' \
  "// was anthropic/claude-haiku-5.5 until 2026-10-01" \
  "/* served by anthropic/claude-haiku-5.5 */" \
  " * anthropic/claude-haiku-5.5 is the default" \
  "export const MODEL = '~anthropic/claude-haiku-latest'")"
put app-04-tests/tests/foo.test.ts "export const MODEL = 'anthropic/claude-haiku-5.5'"
put app-06-llm-playground/netlify/shared/curated.ts "['anthropic/claude-sonnet-5.5', 'strong tool use']"
put app-07-bare/src/Panel.tsx "export const MODEL = 'claude-sonnet-5'"

expect "alias-only file passes" 0 "PINNED-ID CHECK: clean" "$tmp/app-01-alias"
expect "pinned id is reported" 1 "PINNED app-02-pinned/src/model.ts:1: export const MODEL = 'anthropic/claude-haiku-5.5'" "$tmp/app-02-pinned"
expect "ids in // and * comment lines pass" 0 "PINNED-ID CHECK: clean" "$tmp/app-03-comments"
expect "ids under tests/ and *.test.ts pass" 0 "PINNED-ID CHECK: clean" "$tmp/app-04-tests"
expect "allowlisted curated.ts passes" 0 "PINNED-ID CHECK: clean" "$tmp/app-06-llm-playground/netlify"
expect "bare claude-sonnet-5 in .tsx is reported" 1 "PINNED app-07-bare/src/Panel.tsx:1: export const MODEL = 'claude-sonnet-5'" "$tmp/app-07-bare"

echo "$pass passed, $fail failed"
(( fail == 0 ))
