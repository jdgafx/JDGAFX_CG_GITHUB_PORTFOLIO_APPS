#!/bin/bash
# Runs the live check(s). Usage: bash tests/live/run-live.sh [vitest file filter]
# Keys: see load-keys.sh. Needs the netlify CLI logged in.
cd "$(dirname "$0")/../.." || exit 2
source tests/live/load-keys.sh
exec npx vitest run --config tests/live/vitest.config.ts "$@"
