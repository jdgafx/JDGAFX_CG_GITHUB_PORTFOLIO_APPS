#!/usr/bin/env bash
# Prints the sha256 of an app's frozen SP2 sample at a commit (default HEAD).
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then echo "usage: $0 <app-dir> [<sha>]" >&2; exit 2; fi
app=$1
if [[ ! $app =~ ^app-[0-9]{2}-[^/]+$ ]]; then echo "not an app dir: $app" >&2; exit 2; fi
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$root"
sha=$(git rev-parse --verify "${2:-HEAD}^{commit}")
path="config/sp2-samples/$app.json"
if ! git cat-file -e "$sha:$path" 2>/dev/null; then
  echo "no frozen sample for $app at $sha" >&2
  exit 1
fi
git show "$sha:$path" | sha256sum | cut -d' ' -f1
