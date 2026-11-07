#!/usr/bin/env bash
# Check for T-005: test-all-apps.sh agrees with the live apps. It runs the real suite
# against production (real model calls) and passes only when nothing fails.
# Apps 02, 04, 07, 08, 09 and 13 were failing 23 checks because the script was out of date.
set -u
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
out=$("$root/test-all-apps.sh" 2>&1); status=$?
printf '%s\n' "$out" | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Passed:|Failed:|✗' >&2
if (( status != 0 )); then echo "test-all-apps.sh reported failures" >&2; exit 1; fi
echo "test-all-apps.sh: all live checks pass"
