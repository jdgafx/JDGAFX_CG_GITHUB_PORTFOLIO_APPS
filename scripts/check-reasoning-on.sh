#!/usr/bin/env bash
# Flags OpenRouter reasoning turned off (or set to effort low) in app call paths. Thinking stays ON
# (SYSTEM.md section 4, Decision FS); a hit means a call path disabled it.
# Usage: scripts/check-reasoning-on.sh [<path>...]   REASONING_ROOT overrides the repo root.
set -euo pipefail

root=${REASONING_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}

# Repo-relative files that keep reasoning off on purpose, each with its reason. Starts empty:
# hits in them are printed as ALLOWED, never dropped silently.
declare -A allowlist=(
)

# Per non-comment line: flags `enabled: false` or `effort: 'low'` in a reasoning object (the same
# line, or within 3 lines after a line containing `reasoning`), and constants whose value is
# `{ enabled: false }`. Prints "<line>\t<text>" for each hit.
read -r -d '' scan <<'AWK' || true
{
  t = $0
  sub(/^[ \t]+/, "", t)
  sub(/[ \t]+$/, "", t)
  if (t ~ /^(\/\/|\/\*|\*)/) next
  if (t ~ /reasoning/) last = NR
  near = (last > 0 && NR - last <= 3)
  off = (t ~ /enabled[ \t]*:[ \t]*false/)
  low = (t ~ /effort[ \t]*:[ \t]*["']low["']/)
  const_off = (t ~ /(const|let|var)[ \t]+[A-Za-z_$][A-Za-z0-9_$]*[^=]*=[ \t]*\{[ \t]*enabled[ \t]*:[ \t]*false[ \t]*,?[ \t]*\}/)
  if (const_off || (off && near) || (low && near)) print NR "\t" $0
}
AWK

targets=()
if [[ $# -gt 0 ]]; then
  targets=("$@")
else
  shopt -s nullglob
  for dir in "$root"/app-[0-9][0-9]-*/{src,netlify}; do targets+=("$dir"); done
  shopt -u nullglob
fi
if (( ${#targets[@]} == 0 )); then echo "REASONING CHECK: no scan targets under $root" >&2; exit 2; fi

found=$(find "${targets[@]}" \( -name tests -o -name node_modules -o -name dist \) -prune -o \
  -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' \) \
  -not -name '*.test.ts' -not -name '*.test.tsx' -print) \
  || { echo "REASONING CHECK: find failed" >&2; exit 2; }

hits=0
while IFS= read -r file; do
  [[ -n $file ]] || continue
  rel=$(realpath -m --relative-to="$root" "$file")
  matches=$(awk "$scan" "$file") || { echo "REASONING CHECK: awk failed on $rel" >&2; exit 2; }
  while IFS=$'\t' read -r line content; do
    [[ -n $line ]] || continue
    trimmed=$(sed -E 's/^[[:space:]]+|[[:space:]]+$//g' <<<"$content")
    if [[ -n ${allowlist[$rel]+x} ]]; then
      echo "ALLOWED $rel:$line: $trimmed  (${allowlist[$rel]})"
      continue
    fi
    echo "REASONING-OFF $rel:$line: $trimmed"
    hits=$((hits + 1))
  done <<<"$matches"
done <<<"$found"

if (( hits > 0 )); then echo "REASONING CHECK: $hits hit(s)"; exit 1; fi
echo "REASONING CHECK: clean"
