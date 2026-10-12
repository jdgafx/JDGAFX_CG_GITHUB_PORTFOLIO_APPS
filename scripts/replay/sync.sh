#!/usr/bin/env bash
# Copies shared/replay/ byte for byte into each app that replays. Edit the shared copy only, then run this.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
apps=(app-06-llm-playground)
for app in "${apps[@]}"; do
  rm -rf "$root/$app/src/replay"
  mkdir -p "$root/$app/src/replay"
  cp "$root"/shared/replay/*.ts "$root/$app/src/replay/"
done
echo "synced shared/replay into: ${apps[*]}"
