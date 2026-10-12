#!/usr/bin/env bash
# Copies shared/replay/ byte for byte into every app that has a src/replay/ directory. Edit the shared copy only, then run this.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
apps=()
for dir in "$root"/*/src/replay; do
  [ -d "$dir" ] && apps+=("$(basename "$(dirname "$(dirname "$dir")")")")
done
for app in ${apps[@]+"${apps[@]}"}; do
  rm -rf "$root/$app/src/replay"
  mkdir -p "$root/$app/src/replay"
  cp "$root"/shared/replay/*.ts "$root/$app/src/replay/"
done
echo "synced shared/replay into: ${apps[*]-}"
