#!/bin/bash
# Serves the app and its functions on this machine with `netlify dev --offline` (no deploy, no link to the site), with the real
# keys in the environment. Then: AGENTFLOW_DRAFT_URL=http://localhost:8899 bash tests/live/run-live.sh tests/live/draft-run.test.ts
# Usage: bash tests/live/serve-local.sh [port]
cd "$(dirname "$0")/../.." || exit 2
source tests/live/load-keys.sh
exec netlify dev --offline --no-open --port "${1:-8899}"
