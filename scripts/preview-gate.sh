#!/usr/bin/env bash
# Pre-merge gate: an app change reaches main only with a PASS SP2 evidence file
# for a commit whose app tree equals the tip's, and the app tree at new must match it.
set -euo pipefail

if [[ $# -ne 2 ]]; then echo "usage: $0 <old-sha> <new-sha>" >&2; exit 2; fi
old=$1
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$root"
# Evidence lives in the main checkout (.acceptance/ is gitignored), also when pushing from a worktree.
ev=$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)
if [[ ! $old =~ ^0+$ ]] && ! git cat-file -e "$old^{commit}" 2>/dev/null; then
  echo "GATE FAIL range: old sha ${old:0:12} not in local repo, fetch first"
  exit 1
fi
new=$(git rev-parse --verify "$2^{commit}")

# Range to check. A new branch (old all zeros) uses its merge-base with origin/main.
range=""
if [[ $old =~ ^0+$ ]]; then
  base=$(git merge-base origin/main "$new" 2>/dev/null || true)
  if [[ -n $base ]]; then range="$base..$new"; fi
else
  range="$old..$new"
fi
# Without a range, only the new commit itself is checked.
revs=(--no-walk "$new")
if [[ -n $range ]]; then revs=("$range"); fi

# -z keeps names raw (no core.quotePath escaping); tr makes them one per line.
files=$(git log --no-merges --no-renames -z --format= --name-only "${revs[@]}" | tr '\0' '\n')
apps=$(grep -E '^app-[0-9]{2}-[^/]+/' <<<"$files" | cut -d/ -f1 | sort -u || true)
if [[ -z $apps ]]; then
  echo "GATE SKIP no app paths"
  exit 0
fi

# The tip is the newest commit in the range that touches the app.
tip_of() {
  if [[ -n $range ]]; then git log -1 --no-merges --format=%H "$range" -- "$1"; else echo "$new"; fi
}

# Checks evidence $3 (claiming sha $2) for app $1 against the frozen sample $4.
judge() {
  python3 -I - "$3" "$1" "$2" "$4" 2>&1 <<'PY' || return 1
import json, sys
path, app, sha, sample = sys.argv[1:5]
try:
    ev = json.load(open(path, encoding="utf-8"))
except ValueError:
    sys.exit("evidence is not valid JSON")
if not isinstance(ev, dict):
    sys.exit("evidence is not a JSON object")
if ev.get("app") != app:
    sys.exit(f"evidence app is {ev.get('app')!r}, not {app!r}")
if ev.get("sha") != sha:
    sys.exit("evidence sha is not the commit sha")
if ev.get("sample_sha256") != sample:
    sys.exit("sample_sha256 does not match the frozen sample")
if ev.get("verdict") != "PASS":
    sys.exit(f"verdict is {ev.get('verdict')!r}, not PASS")
if not str(ev.get("preview_url", "")).startswith("https://"):
    sys.exit("preview_url is not an https:// URL")
checklist = ev.get("checklist") if isinstance(ev.get("checklist"), dict) else {}
for item in "12345678":
    if checklist.get(item) != "PASS":
        sys.exit(f"checklist item {item} is {checklist.get(item)!r}, not PASS")
PY
  # The pushed app tree must be the one the evidence verified (catches unverified merges).
  if ! git diff --quiet "$2" "$new" -- "$1"; then
    echo "app tree at ${new:0:12} differs from the verified commit"
    return 1
  fi
}

# Prints the evidence sha that passes for app $1 at tip $2, else the reason.
check() {
  local sample S f reason="no evidence file for this commit"
  # The tip's own evidence wins; otherwise any evidence for an identical app tree.
  local cands=("$ev/.acceptance/gate/$1/$2.json")
  if [[ ! -f ${cands[0]} ]]; then cands=("$ev/.acceptance/gate/$1"/*.json); fi
  [[ -f ${cands[0]} ]] || { echo "$reason"; return 1; }
  if ! sample=$("$root/scripts/sp2-sample-hash.sh" "$1" "$2" 2>/dev/null); then
    echo "no frozen sample committed"
    return 1
  fi
  for f in "${cands[@]}"; do
    S=$(basename "$f" .json)
    [[ -f $f && $S =~ ^[0-9a-f]{40}$ ]] || continue
    git cat-file -e "$S^{commit}" 2>/dev/null || continue
    git diff --quiet "$S" "$2" -- "$1" || continue
    if reason=$(judge "$1" "$S" "$f" "$sample"); then
      echo "$S"
      return 0
    fi
  done
  echo "$reason"
  return 1
}

status=0
while read -r app; do
  if ! git cat-file -e "$new:$app" 2>/dev/null; then
    echo "GATE SKIP $app removed"
    continue
  fi
  tip=$(tip_of "$app")
  if out=$(check "$app" "$tip"); then
    if [[ $out == "$tip" ]]; then
      echo "GATE PASS $app ${tip:0:12}"
    else
      echo "GATE PASS $app ${tip:0:12} (evidence ${out:0:12}, same app tree)"
    fi
  else
    echo "GATE FAIL $app ${tip:0:12}: $out"
    status=1
  fi
done <<<"$apps"
exit $status
