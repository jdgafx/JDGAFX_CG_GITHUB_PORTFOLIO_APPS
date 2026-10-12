#!/usr/bin/env bash
# Runs scripts/preview-gate.sh against a throwaway repo, one case per rule.
set -euo pipefail

scripts_dir=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"

git init -q "$repo"
cd "$repo"
git config user.name "gate test"
git config user.email "gate-test@example.invalid"
git config commit.gpgsign false
mkdir -p scripts
cp "$scripts_dir/preview-gate.sh" "$scripts_dir/sp2-sample-hash.sh" scripts/
echo ".acceptance/" >.gitignore

put() { mkdir -p "$(dirname "$1")"; echo "$2" >"$1"; }
commit() { git add -A && git commit -qm "$1" && git rev-parse HEAD; }
# sha256 of the frozen sample for app $1 as committed at sha $2.
hash_of() { git show "$2:config/sp2-samples/$1.json" | sha256sum | cut -d' ' -f1; }

# Writes the evidence file for app $1 at sha $2 with verdict $3, item 7 $4, sample hash $5.
evidence() {
  mkdir -p ".acceptance/gate/$1"
  cat >".acceptance/gate/$1/$2.json" <<EOF
{"app": "$1", "sha": "$2", "verdict": "$3", "sample_sha256": "$5",
 "preview_url": "https://preview.example.test/$1",
 "checklist": {"1": "PASS", "2": "PASS", "3": "PASS", "4": "PASS",
   "5": "PASS", "6": "PASS", "7": "$4", "8": "PASS"}}
EOF
}

put README.md "portfolio"
put app-01-alpha/a.txt "v1"
put config/sp2-samples/app-01-alpha.json '{"questions": ["q1", "q2"]}'
put config/sp2-samples/app-02-beta.json '{"questions": ["q3"]}'
A=$(commit "base")
put docs/notes.md "note"
B=$(commit "docs only")
put app-01-alpha/a.txt "v2"
C=$(commit "app-01 v2")
put app-01-alpha/a.txt "v3"
D=$(commit "app-01 v3")
put app-02-beta/b.txt "v1"
E=$(commit "app-02 v1")
put app-01-alpha/a.txt "v4"
F=$(commit "app-01 v4")
put app-03-gamma/c.txt "v1"
G=$(commit "app-03 v1, no sample")

n=0
fails=0
# Args: name, expected exit, old sha, new sha, regex the output must match.
run_case() {
  local out rc=0
  n=$((n + 1))
  out=$(bash scripts/preview-gate.sh "$3" "$4" 2>&1) || rc=$?
  if [[ $rc -eq $2 ]] && grep -Eq "$5" <<<"$out"; then
    echo "PASS $n: $1"
  else
    echo "FAIL $n: $1 (exit $rc, wanted $2)"
    fails=$((fails + 1))
  fi
  sed 's/^/    /' <<<"$out"
}

run_case "docs-only range is skipped" 0 "$A" "$B" "^GATE SKIP no app paths$"
run_case "app change without evidence fails" 1 "$B" "$C" "^GATE FAIL app-01-alpha [0-9a-f]{12}: no evidence"
evidence app-01-alpha "$C" FAIL PASS "$(hash_of app-01-alpha "$C")"
run_case "evidence with verdict FAIL fails" 1 "$B" "$C" "^GATE FAIL app-01-alpha .*verdict is 'FAIL'"
evidence app-01-alpha "$C" PASS PASS "$(hash_of app-01-alpha "$C")"
run_case "evidence for an older sha only fails" 1 "$B" "$D" "^GATE FAIL app-01-alpha .*no evidence"
evidence app-01-alpha "$D" PASS FAIL "$(hash_of app-01-alpha "$D")"
run_case "checklist item 7 FAIL fails" 1 "$B" "$D" "^GATE FAIL app-01-alpha .*checklist item 7"
evidence app-01-alpha "$D" PASS PASS "$(hash_of app-01-alpha "$D")"
run_case "valid PASS evidence for the tip passes" 0 "$B" "$D" "^GATE PASS app-01-alpha [0-9a-f]{12}$"
evidence app-01-alpha "$F" PASS PASS "$(hash_of app-01-alpha "$F")"
run_case "two apps, only one with evidence fails" 1 "$D" "$F" "^GATE FAIL app-02-beta .*no evidence"
evidence app-01-alpha "$F" PASS PASS "$(echo other | sha256sum | cut -d' ' -f1)"
run_case "evidence for a different sample fails" 1 "$D" "$F" "^GATE FAIL app-01-alpha .*sample_sha256 does not match"
evidence app-03-gamma "$G" PASS PASS "$(hash_of app-01-alpha "$F")"
run_case "app with no frozen sample committed fails" 1 "$F" "$G" "^GATE FAIL app-03-gamma .*no frozen sample committed"

n=$((n + 1))
got=$(bash scripts/sp2-sample-hash.sh app-01-alpha)
want=$(git show HEAD:config/sp2-samples/app-01-alpha.json | sha256sum | cut -d' ' -f1)
if [[ $got == "$want" ]] && ! bash scripts/sp2-sample-hash.sh app-03-gamma >/dev/null 2>&1; then
  echo "PASS $n: sp2-sample-hash.sh matches git show and refuses a missing sample"
else
  echo "FAIL $n: sp2-sample-hash.sh output $got, wanted $want, or a missing sample did not exit 1"
  fails=$((fails + 1))
fi

# Parallel branches: branch a changes x, a newer branch b changes y, then merge M.
put config/sp2-samples/app-04-delta.json '{"questions": ["q4"]}'
H=$(commit "app-04 sample")
git checkout -q -b branch-a "$H"
put app-04-delta/x.txt "a1"
commit "branch a" >/dev/null
git checkout -q -b branch-b "$H"
sleep 1
put app-04-delta/y.txt "b1"
Bt=$(commit "branch b")
git checkout -q branch-a
git merge -q --no-ff -m "merge b" branch-b
M=$(git rev-parse HEAD)
evidence app-04-delta "$Bt" PASS PASS "$(hash_of app-04-delta "$Bt")"
run_case "merge with an unverified branch change fails" 1 "$H" "$M" \
  "^GATE FAIL app-04-delta [0-9a-f]{12}: app tree at [0-9a-f]{12} differs from the verified commit$"

put "app-05-epsilon/café.txt" "v1"
K=$(commit "app-05 non-ASCII path")
run_case "non-ASCII app path is not skipped" 1 "$M" "$K" "^GATE FAIL app-05-epsilon [0-9a-f]{12}: no evidence"

put app-08-eta/e.txt "v1"
L=$(commit "app-08 add")
rm -rf app-08-eta
R=$(commit "remove app-08")
run_case "removed app dir is skipped" 0 "$L" "$R" "^GATE SKIP app-08-eta removed$"

run_case "old sha missing locally fails with a fetch hint" 1 \
  0123456789abcdef0123456789abcdef01234567 "$R" \
  "^GATE FAIL range: old sha 0123456789ab not in local repo, fetch first$"

# Rebase: the same app tree under a new sha, now behind a docs-only commit.
put app-09-theta/t.txt "v1"
put config/sp2-samples/app-09-theta.json '{"questions": ["q9"]}'
S9=$(commit "app-09 v1")
evidence app-09-theta "$S9" PASS PASS "$(hash_of app-09-theta "$S9")"
git checkout -q -b rebased "$R"
put docs/rebase.md "docs"
commit "docs on the new base" >/dev/null
git cherry-pick "$S9" >/dev/null
RB=$(git rev-parse HEAD)
run_case "evidence for an identical app tree passes" 0 "$R" "$RB" \
  '^GATE PASS app-09-theta [0-9a-f]{12} [(]evidence [0-9a-f]{12}, same app tree[)]$'

git checkout -q -b differ "$RB"
put app-09-theta/t.txt "v2"
RB2=$(commit "app-09 v2")
run_case "evidence for a different app tree fails" 1 "$R" "$RB2" "^GATE FAIL app-09-theta [0-9a-f]{12}: no evidence"

git checkout -q -b sampled "$RB"
put app-09-theta/t.txt "v2"
commit "app-09 v2 again" >/dev/null
put app-09-theta/t.txt "v1"
put config/sp2-samples/app-09-theta.json '{"questions": ["q9", "q10"]}'
Y=$(commit "app-09 back to v1 with a new sample")
run_case "identical app tree with a changed sample fails" 1 "$R" "$Y" \
  "^GATE FAIL app-09-theta [0-9a-f]{12}: sample_sha256 does not match"

# A sample-only commit after the app tip: evidence for it with the new sample's hash passes.
git checkout -q -b resampled "$RB"
put config/sp2-samples/app-09-theta.json '{"questions": ["q9", "v2"]}'
Z=$(commit "app-09 sample v2 only")
run_case "sample-only commit: evidence for the old sample fails" 1 "$R" "$Z" \
  "^GATE FAIL app-09-theta [0-9a-f]{12}: sample_sha256 does not match"
evidence app-09-theta "$Z" PASS PASS "$(hash_of app-09-theta "$Z")"
run_case "sample-only commit with evidence for the new sample passes" 0 "$R" "$Z" \
  '^GATE PASS app-09-theta [0-9a-f]{12} [(]evidence [0-9a-f]{12}, same app tree[)]$'

# A pre-push hook runs with GIT_DIR set (always so from a worktree); the scripts must still find themselves.
n=$((n + 1))
if out=$(GIT_DIR="$repo/.git" bash scripts/preview-gate.sh "$R" "$Z" 2>&1) && grep -q "^GATE PASS app-09-theta" <<<"$out"; then
  echo "PASS $n: gate passes with GIT_DIR set, as in a pre-push hook"
else
  echo "FAIL $n: gate with GIT_DIR set"; fails=$((fails + 1)); sed 's/^/    /' <<<"$out"
fi

echo "$((n - fails))/$n passed"
[[ $fails -eq 0 ]]
