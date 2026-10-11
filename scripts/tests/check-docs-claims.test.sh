#!/usr/bin/env bash
# Runs scripts/check-docs-claims.sh against throwaway trees, one tree per case.
set -euo pipefail

checker=$(cd "$(dirname "$0")/../.." && pwd)/scripts/check-docs-claims.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
pass=0
fail=0

# put <case> <repo-relative path> <text>
put() { mkdir -p "$(dirname "$tmp/$1/$2")"; printf '%s\n' "$3" >"$tmp/$1/$2"; }

# expect <case> <want-exit> <want-text>...: every want-text must appear in the output
expect() {
  local name=$1 want_rc=$2 out rc=0 want ok=1
  shift 2
  out=$(DOCS_ROOT="$tmp/$name" bash "$checker" 2>&1) || rc=$?
  for want in "$@"; do [[ $out == *"$want"* ]] || ok=0; done
  if [[ $rc -eq $want_rc && $ok -eq 1 ]]; then
    echo "ok   - $name"
    pass=$((pass + 1))
  else
    echo "FAIL - $name (exit $rc, want $want_rc)"
    sed 's/^/     /' <<<"$out"
    fail=$((fail + 1))
  fi
}

put alias-only README.md 'Model: ~anthropic/claude-haiku-latest, the newest release.'
expect alias-only 0 'DOCS-CLAIM CHECK: clean'

put pinned-app-readme app-02-rag-document-intelligence/README.md 'Uses anthropic/claude-haiku-5.5 for answers.'
expect pinned-app-readme 1 'CLAIM model app-02-rag-document-intelligence/README.md:1: Uses anthropic/claude-haiku-5.5 for answers.'

put fenced-block docs/run.md "$(printf '%s\n' 'Captured output:' '```' 'served: anthropic/claude-haiku-5.5' '```')"
expect fenced-block 0 'DOCS-CLAIM CHECK: clean'

put older-n8n-id n8n-automations/x.md 'Node model: claude-haiku-4.5'
expect older-n8n-id 1 'CLAIM model n8n-automations/x.md:1: Node model: claude-haiku-4.5'

put root-ten README.md 'Ten AI apps in one portfolio.'
expect root-ten 1 'CLAIM count README.md:1: Ten AI apps in one portfolio.'

put root-13 README.md '13 apps in one portfolio.'
expect root-13 0 'DOCS-CLAIM CHECK: clean'

put app-two-apps app-03-ai-code-review/README.md "$(printf '%s\n' 'This app is one of two apps.' 'Part of 2 apps in the portfolio.')"
expect app-two-apps 0 'DOCS-CLAIM CHECK: clean'

put root-often README.md 'Often apps stay in one portfolio.'
expect root-often 0 'DOCS-CLAIM CHECK: clean'

put allowlisted docs/2026-10-07-haiku-audit.md "$(printf '%s\n' 'Model: anthropic/claude-haiku-5.5.' 'Scope: the 10 apps.')"
expect allowlisted 0 'ALLOWED model docs/2026-10-07-haiku-audit.md:1: Model: anthropic/claude-haiku-5.5.' \
  'ALLOWED count docs/2026-10-07-haiku-audit.md:2: Scope: the 10 apps.' 'DOCS-CLAIM CHECK: clean'

echo "$pass passed, $fail failed"
(( fail == 0 ))
