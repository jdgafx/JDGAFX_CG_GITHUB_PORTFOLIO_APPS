#!/usr/bin/env bash
# Fails if any app's src/replay (every app that has one) differs from shared/replay in any file.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
apps=()
for dir in "$root"/*/src/replay; do
  [ -d "$dir" ] && apps+=("$(basename "$(dirname "$(dirname "$dir")")")")
done
status=0
for app in ${apps[@]+"${apps[@]}"}; do
  if ! diff -r "$root/shared/replay" "$root/$app/src/replay" >/dev/null; then
    echo "DIFFERS: $app/src/replay is not identical to shared/replay (run scripts/replay/sync.sh)" >&2
    status=1
  fi
done
[ "$status" -eq 0 ] && echo "replay copies identical: ${apps[*]-}"
exit "$status"
