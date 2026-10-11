#!/usr/bin/env bash
# Runs scripts/check-reasoning-on.sh against a throwaway tree, one case per rule.
set -euo pipefail

checker=$(cd "$(dirname "$0")/.." && pwd)/check-reasoning-on.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
pass=0
fail=0
script=$checker

put() { mkdir -p "$(dirname "$tmp/$1")"; printf '%s\n' "$2" >"$tmp/$1"; }

# expect <name> <want-exit> <want-text or ""> <scan path>...
expect() {
  local name=$1 want_rc=$2 want_text=$3 out rc=0
  shift 3
  out=$(REASONING_ROOT="$tmp" bash "$script" "$@" 2>&1) || rc=$?
  if [[ $rc -eq $want_rc && ( -z $want_text || $out == *"$want_text"* ) ]]; then
    echo "ok   - $name"
    pass=$((pass + 1))
  else
    echo "FAIL - $name (exit $rc, want $want_rc)"
    sed 's/^/     /' <<<"$out"
    fail=$((fail + 1))
  fi
}

put app-01-plain/src/call.ts "$(printf '%s\n' \
  "export async function call(model: string) {" \
  "  return fetch(model, { body: JSON.stringify({ max_tokens: 900 }) })" \
  "}")"
put app-02-one/src/call.ts "const body = { reasoning: { enabled: false }, model: 'x' }"
put app-03-multi/src/call.ts "$(printf '%s\n' \
  "const body = {" \
  "  reasoning: {" \
  "    enabled: false," \
  "  }," \
  "}")"
put app-04-const/src/lib/flags.ts "const NO_REASONING = { enabled: false }"
put app-05-comments/src/notes.ts "$(printf '%s\n' \
  "// reasoning: { enabled: false }" \
  "/* reasoning: { enabled: false } */" \
  " * reasoning: { enabled: false }" \
  "export const MODEL = 'x'")"
put app-06-tests/tests/x.test.ts "const body = { reasoning: { enabled: false } }"
put app-07-cache/src/opts.ts "$(printf '%s\n' \
  "export const cacheOpts = { cache: { enabled: false } }" \
  "export const a = 1" \
  "export const b = 2" \
  "export const c = 3")"
put app-08-effort/src/call.ts "const body = { reasoning: { effort: 'low' } }"
put app-09-allowed/src/lib/off.ts "const body = { reasoning: { enabled: false } }"

# Copy of the checker with one allowlist entry, so the ALLOWED path can be exercised.
allow_checker=$tmp/checker-with-fixture-allow.sh
sed 's|^declare -A allowlist=($|&\n  ['"'"'app-09-allowed/src/lib/off.ts'"'"']='"'"'test fixture reason'"'"'|' "$checker" >"$allow_checker"

expect "body without reasoning is clean" 0 "REASONING CHECK: clean" "$tmp/app-01-plain"
expect "one-line reasoning enabled:false is reported" 1 "REASONING-OFF app-02-one/src/call.ts:1: const body = { reasoning: { enabled: false }, model: 'x' }" "$tmp/app-02-one"
expect "multi-line reasoning then enabled:false is reported" 1 "REASONING-OFF app-03-multi/src/call.ts:3: enabled: false," "$tmp/app-03-multi"
expect "const NO_REASONING = { enabled: false } is reported" 1 "REASONING-OFF app-04-const/src/lib/flags.ts:1: const NO_REASONING = { enabled: false }" "$tmp/app-04-const"
expect "same text in // and * comments is clean" 0 "REASONING CHECK: clean" "$tmp/app-05-comments"
expect "reasoning off under tests/ is clean" 0 "REASONING CHECK: clean" "$tmp/app-06-tests"
expect "enabled:false without reasoning nearby is clean" 0 "REASONING CHECK: clean" "$tmp/app-07-cache"
expect "reasoning effort low is reported" 1 "REASONING-OFF app-08-effort/src/call.ts:1: const body = { reasoning: { effort: 'low' } }" "$tmp/app-08-effort"
script=$allow_checker
expect "allowlisted file prints ALLOWED with reason and exits 0" 0 "ALLOWED app-09-allowed/src/lib/off.ts:1: const body = { reasoning: { enabled: false } }  (test fixture reason)" "$tmp/app-09-allowed"
script=$checker

echo "$pass passed, $fail failed"
(( fail == 0 ))
