#!/usr/bin/env bash
# Flags README and docs text that names a model id other than the family alias, or an app count other than 13.
# Usage: scripts/check-docs-claims.sh [<path>...]   DOCS_ROOT overrides the repo root.
# Fenced code blocks (``` or ~~~) are skipped entirely, for both rules.
set -euo pipefail

root=${DOCS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}
model_re='(anthropic/)?claude-(haiku|sonnet|opus|fable)-[0-9]'
count_re='\b([0-9]+|ten|eleven|twelve|fourteen) (ai )?(apps|applications)\b'
fence_re='^[[:space:]]*(```|~~~)'

# Repo-relative files whose ids and counts are dated records. Hits there print as ALLOWED, never counted.
declare -A allowlist=(
  ['docs/2026-10-07-haiku-audit.md']='dated audit record from 2026-10-07; its model ids and app counts are historical'
)

hits=0
report() {  # report <rule> <rel> <line-no> <line>
  local trimmed
  trimmed=$(sed -E 's/^[[:space:]]+|[[:space:]]+$//g' <<<"$4")
  if [[ -n ${allowlist[$2]+x} ]]; then echo "ALLOWED $1 $2:$3: $trimmed  (${allowlist[$2]})"; return; fi
  echo "CLAIM $1 $2:$3: $trimmed"
  hits=$((hits + 1))
}

scan() {  # scan <file>
  local file=$1 rel n=0 fence=0 line count=0 rest
  rel=$(realpath -m --relative-to="$root" "$file")
  case $rel in README.md | docs/*) count=1 ;; esac
  while IFS= read -r line || [[ -n $line ]]; do
    n=$((n + 1))
    if [[ $line =~ $fence_re ]]; then fence=$((1 - fence)); continue; fi
    (( fence == 0 )) || continue
    if [[ $line =~ $model_re ]]; then report model "$rel" "$n" "$line"; fi
    if (( count )); then
      rest=${line,,}
      while [[ $rest =~ $count_re ]]; do
        if [[ ! ${BASH_REMATCH[1]} =~ ^(0*13|thirteen)$ ]]; then report count "$rel" "$n" "$line"; break; fi
        rest=${rest#*"${BASH_REMATCH[0]}"}
      done
    fi
  done <"$file"
}

files=()
if [[ $# -gt 0 ]]; then
  for arg in "$@"; do
    if [[ -d $arg ]]; then while IFS= read -r f; do files+=("$f"); done < <(find "$arg" -name '*.md' | sort)
    else files+=("$arg"); fi
  done
else
  shopt -s globstar nullglob
  for f in "$root"/README.md "$root"/app-[0-9][0-9]-*/README.md "$root"/docs/**/*.md "$root"/n8n-automations/**/*.md; do
    [[ -f $f ]] && files+=("$f")
  done
  shopt -u globstar nullglob
fi
if (( ${#files[@]} == 0 )); then echo "DOCS-CLAIM CHECK: no scan targets under $root" >&2; exit 2; fi

for file in "${files[@]}"; do
  [[ -f $file ]] || { echo "DOCS-CLAIM CHECK: no such file $file" >&2; exit 2; }
  scan "$file"
done

if (( hits > 0 )); then echo "DOCS-CLAIM CHECK: $hits hit(s)"; exit 1; fi
echo "DOCS-CLAIM CHECK: clean"
