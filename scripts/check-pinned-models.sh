#!/usr/bin/env bash
# Flags pinned model ids in app call paths. Call paths use the family alias
# (~anthropic/claude-<family>-latest), so a family name always means the latest release.
# Usage: scripts/check-pinned-models.sh [<path>...]   PINNED_ROOT overrides the repo root.
set -euo pipefail

root=${PINNED_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}
pattern='(anthropic/)?claude-(haiku|sonnet|opus|fable)-[0-9]'

# Repo-relative files that list pinned ids on purpose, each with its reason. Hits in them are
# printed as ALLOWED, never dropped silently.
declare -A allowlist=(
  ['app-06-llm-playground/netlify/shared/curated.ts']='model catalogue the arena visitor picks from; the arena compares named models by design'
  ['app-06-llm-playground/src/lib/defaultPicks.ts']='panel B/C default picks, which must be curated catalogue ids (run.ts:78)'
  ['app-06-llm-playground/src/lib/run.ts']='TEMPORARY: DEFAULT_PICKS (curated catalogue ids, run.ts:78-82) until they move to defaultPicks.ts in step 4; remove this entry then'
)

targets=()
if [[ $# -gt 0 ]]; then
  targets=("$@")
else
  shopt -s nullglob
  for dir in "$root"/app-[0-9][0-9]-*/{src,netlify}; do targets+=("$dir"); done
  shopt -u nullglob
fi
if (( ${#targets[@]} == 0 )); then echo "PINNED-ID CHECK: no scan targets under $root" >&2; exit 2; fi

status=0
matches=$(grep -rnE --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
  --exclude-dir=tests --exclude-dir=node_modules --exclude-dir=dist \
  --exclude='*.test.ts' --exclude='*.test.tsx' \
  -e "$pattern" -- "${targets[@]}") || status=$?
if (( status > 1 )); then echo "PINNED-ID CHECK: grep failed (exit $status)" >&2; exit 2; fi

hits=0
while IFS= read -r hit; do
  [[ -n $hit ]] || continue
  file=${hit%%:*}; rest=${hit#*:}; line=${rest%%:*}; content=${rest#*:}
  rel=$(realpath -m --relative-to="$root" "$file")
  trimmed=$(sed -E 's/^[[:space:]]+|[[:space:]]+$//g' <<<"$content")
  case "$trimmed" in
    //*|/\**|\**) continue ;;
  esac
  if [[ -n ${allowlist[$rel]+x} ]]; then
    echo "ALLOWED $rel:$line: $trimmed  (${allowlist[$rel]})"
    continue
  fi
  echo "PINNED $rel:$line: $trimmed"
  hits=$((hits + 1))
done <<<"$matches"

if (( hits > 0 )); then echo "PINNED-ID CHECK: $hits hit(s)"; exit 1; fi
echo "PINNED-ID CHECK: clean"
