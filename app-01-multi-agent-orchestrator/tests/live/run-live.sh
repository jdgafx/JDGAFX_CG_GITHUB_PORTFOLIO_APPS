#!/bin/bash
# Runs the live check(s). Usage: bash tests/live/run-live.sh [vitest file filter]
# TAVILY_API_KEY and OPENROUTER_API_KEY come from the environment; when one is not set, from app-01's Netlify site (the value
# goes into the test process only and is never printed). Needs the netlify CLI logged in.
cd "$(dirname "$0")/../.." || exit 2
for name in TAVILY_API_KEY OPENROUTER_API_KEY; do
  if [ -z "${!name:-}" ]; then
    value="$(netlify api getEnvVar --data "{\"account_id\":\"jdgafx\",\"key\":\"$name\",\"site_id\":\"f6e0febf-0edc-40c3-bbf3-b9984b25139a\"}" 2>/dev/null | python3 -c "
import sys, json
print(json.load(sys.stdin)['values'][0]['value'], end='')
")"
    export "$name=$value"
  fi
done
exec npx vitest run --config tests/live/vitest.config.ts "$@"
