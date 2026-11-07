#!/usr/bin/env bash
# Live smoke suite for the thirteen Netlify AI apps in this portfolio.
#
# Per app: the frontend loads and its JS bundle carries the author credit; the
# main function answers GET with 405 and an empty POST with a 400 error; one
# real task returns the values its contract promises. Streams are read as
# text/event-stream data frames. Every request sends the app's live URL as
# Origin, since the functions check Origin before they check the method.
#
# Usage:
#   ./test-all-apps.sh              all apps against production
#   ./test-all-apps.sh local        all apps against http://localhost:8888
#   ./test-all-apps.sh app-03       one app against production
#
# Needs bash, curl and jq. Each run makes real model calls, so it costs usage.
# Exit status is 1 when any check fails.

set -u

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

MODE=prod
PASS=0
FAIL=0
FAILED=()
CURRENT=""
BASE=""
ORIGIN=""
CODE=""
CTYPE=""
BODY=""

declare -A SLUG=(
  [01]=multi-agent-orchestrator [02]=rag-document-intelligence [03]=ai-code-review
  [04]=voice-ai-assistant [05]=ai-data-analyst [06]=llm-playground
  [07]=content-pipeline [08]=vision-ai [09]=ai-saas [10]=browser-agent
  [11]=langgraph-research-agent [12]=langgraph-approval-flow [13]=langgraph-map-reduce
)

# A 1x1 white PNG, sent to the vision app.
VISION_PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'

# jq prelude for event streams. frame KEY VALUE is the last frame whose KEY
# equals VALUE. sse_done is true when the stream ends with [DONE].
SSE_DEFS='
def sse_lines: split("\n") | map(sub("\r$"; ""));
def sse_frames: [sse_lines[] | select(startswith("data:")) | ltrimstr("data:") | ltrimstr(" ") | select(. != "[DONE]") | fromjson];
def frame(k; v): [sse_frames[] | select(.[k] == v)] | last;
def sse_done: any(sse_lines[]; . == "data: [DONE]" or . == "data:[DONE]");
'

pass() { PASS=$((PASS + 1)); printf '  %b✓ PASS%b %s\n' "$GREEN" "$NC" "$1"; }

# excerpt TEXT: one line of at most 160 characters, for failure output.
excerpt() {
  local s=${1//$'\n'/ }
  s=${s//$'\r'/ }
  [[ -n $s ]] || s='(empty)'
  printf '%s' "${s:0:160}"
}

# fail LABEL [DETAIL]: records the check and prints what came back.
fail() {
  FAIL=$((FAIL + 1))
  FAILED+=("$CURRENT: $1")
  printf '  %b✗ FAIL%b %s\n' "$RED" "$NC" "$1"
  if (( $# > 1 )); then printf '         got: %s\n' "$(excerpt "$2")"; fi
}

# call METHOD URL TIMEOUT [JSON]: one request. Sets CODE (000 when there is no
# response), CTYPE and BODY. The status line follows the body in curl's output,
# so nothing is written to disk.
call() {
  local method=$1 url=$2 timeout=$3 out line
  local -a args=(-sS -X "$method" --max-time "$timeout" -H "Origin: $ORIGIN"
    -w $'\n%{http_code} %{content_type}')
  if (( $# > 3 )); then args+=(-H 'Content-Type: application/json' --data-raw "$4"); fi
  out=$(curl "${args[@]}" "$url" 2>/dev/null) || true
  line=${out##*$'\n'}
  BODY=${out%$'\n'*}
  CODE=${line%% *}
  CODE=${CODE:-000}
  CTYPE=
  if [[ $line == *' '* ]]; then CTYPE=${line#* }; fi
}

# expect_status LABEL CODE: the last call returned CODE.
expect_status() {
  if [[ $CODE == "$2" ]]; then pass "$1"; else fail "$1 (HTTP $CODE, want $2)" "$BODY"; fi
}

# expect_type PREFIX: the last response has a Content-Type starting with PREFIX.
expect_type() {
  if [[ $CTYPE == "$1"* ]]; then pass "content type starts with $1"; else fail "content type starts with $1" "$CTYPE"; fi
}

# expect LABEL FILTER: FILTER is true for the last JSON body.
expect() {
  if jq -e "$2" >/dev/null 2>&1 <<<"$BODY"; then pass "$1"; else fail "$1" "$BODY"; fi
}

# expect_sse LABEL FILTER: FILTER is true for the last event stream.
expect_sse() {
  if jq -Rse "$SSE_DEFS $2" >/dev/null 2>&1 <<<"$BODY"; then pass "$1"; else fail "$1" "$BODY"; fi
}

# has_keys KEY...: a jq filter that is true when every KEY is present.
has_keys() {
  local filter=true key
  for key in "$@"; do filter+=" and has(\"$key\")"; done
  printf '%s' "$filter"
}

# check_frontend: the page loads, and a script it references has the author credit.
check_frontend() {
  local srcs src url js=""
  call GET "$BASE/" 30
  expect_status "frontend loads" 200
  srcs=$(grep -oE 'src="[^"]+\.(m?js|[jt]sx?)(\?[^"]*)?"' <<<"$BODY" | sed -E 's/^src="//; s/"$//')
  if [[ -z $srcs ]]; then fail "HTML references a JS bundle" "$BODY"; return 0; fi
  pass "HTML references a JS bundle"
  while IFS= read -r src; do
    case $src in
      http*) url=$src ;;
      /*) url=$BASE$src ;;
      *) url=$BASE/$src ;;
    esac
    call GET "$url" 30
    js+=$BODY
  done <<<"$srcs"
  if [[ $js == *"Christopher Gentile"* ]]; then
    pass "JS bundle contains the author credit"
  else
    fail "JS bundle contains the author credit" "${#js} bytes of script, no match"
  fi
}

# reject_checks PATH: GET is 405, and POST {} is 400 with an error string.
reject_checks() {
  call GET "$BASE$1" 30
  expect_status "GET $1 returns 405" 405
  call POST "$BASE$1" 30 '{}'
  expect_status "POST {} $1 returns 400" 400
  expect "POST {} $1 error is a non-empty string" '.error | type == "string" and length > 0'
}

###############################################################################
# Per-app checks. Each one leaves BODY holding the response it checks last.
###############################################################################

# The retriever reads Wikipedia and Hacker News, so the question must be one they have pages on.
app_01() {
  reject_checks /api/ai
  expect "POST {} /api/ai error is Missing query." '.error == "Missing query."'
  call POST "$BASE/api/ai" 60 '{"query":"In two sentences, explain what the xz backdoor was."}'
  expect_status "agent pipeline returns 200" 200
  expect_type text/event-stream
  expect_sse "four agent_complete events" '[sse_frames[] | select(.type == "agent_complete")] | length == 4'
  expect_sse "session_complete has result, trace, usage, model, totalMs" "frame(\"type\"; \"session_complete\") | $(has_keys result trace usage model totalMs)"
  expect_sse "session_complete model.servedModel is a non-empty string and usage.total_tokens > 0" 'frame("type"; "session_complete") | (.model.servedModel | type == "string" and length > 0) and (.usage.total_tokens // 0) > 0'
  expect_sse "stream ends with [DONE]" 'sse_done'
}

app_02() {
  reject_checks /api/ai
  call POST "$BASE/api/ai" 30 '{"question":"In what year was the Harbor Station opened?","chunks":["[Chunk 0]:\nThe Harbor Station was opened in 1987 in Lisbon."],"documentTitle":"harbor.pdf"}'
  expect_status "answer returns 200" 200
  expect_type text/event-stream
  expect_sse "result frame run has result, trace, usage, servedModel, totalMs" "frame(\"type\"; \"result\") | .run | $(has_keys result trace usage servedModel totalMs)"
  expect_sse "run.result.answer contains 1987" 'frame("type"; "result") | .run.result.answer | type == "string" and contains("1987")'
  expect_sse "servedModel is a non-empty string" 'frame("type"; "result") | .run.servedModel | type == "string" and length > 0'
  expect_sse "stream ends with [DONE]" 'sse_done'
}

app_03() {
  reject_checks /api/ai
  expect "POST {} /api/ai has success false" '.success == false'
  call POST "$BASE/api/ai" 30 '{"code":"def divide(a, b):\n    return a / b","language":"python"}'
  expect_status "review returns 200" 200
  expect "keys: success result trace usage model totalMs" "$(has_keys success result trace usage model totalMs)"
  expect "success is true" '.success == true'
  expect "result.comments is a non-empty array" '.result.comments | type == "array" and length > 0'
  expect "a comment cites line 2" '.result.comments | any(.line == 2)'
  expect "model is a non-empty string" '.model | type == "string" and length > 0'
}

app_04() {
  reject_checks /api/ai
  expect "POST {} /api/ai has trace and totalMs" "$(has_keys trace totalMs)"
  call POST "$BASE/api/ai" 30 '{"message":"Reply with the single word: pong"}'
  expect_status "chat returns 200" 200
  expect_type text/event-stream
  expect_sse "done frame has result, model, usage, totalMs" "frame(\"type\"; \"done\") | $(has_keys result model usage totalMs)"
  expect_sse "done result contains pong, case-insensitive" 'frame("type"; "done") | .result | type == "string" and (ascii_downcase | contains("pong"))'
  expect_sse "stream carries trace step frames" 'any(sse_frames[]; .type == "step")'
  expect_sse "stream ends with [DONE]" 'sse_done'
  call POST "$BASE/api/transcribe" 30 '{}'
  expect_status "POST {} /api/transcribe returns 400" 400
  expect "POST {} /api/transcribe error is a non-empty string" '.error | type == "string" and length > 0'
}

app_05() {
  reject_checks /api/ai
  call POST "$BASE/api/ai" 30 '{"question":"Which product has the highest total revenue?","headers":["product","revenue"],"sampleRows":[{"product":"Gadget Y","revenue":"24000"}],"rowCount":50}'
  expect_status "query plan returns 200" 200
  expect "keys: result trace usage model totalMs" "$(has_keys result trace usage model totalMs)"
  expect "result.groupBy is product" '.result.groupBy == "product"'
  expect "result.aggregate.field is revenue" '.result.aggregate.field == "revenue"'
  expect "model is a non-empty string" '.model | type == "string" and length > 0'
}

app_06() {
  local model
  call GET "$BASE/api/models" 30
  expect_status "GET /api/models returns 200" 200
  expect "keys: source fetchedAt defaultModel groups" "$(has_keys source fetchedAt defaultModel groups)"
  expect "groups is non-empty" '.groups | length > 0'
  model=$(jq -r '.defaultModel // empty' 2>/dev/null <<<"$BODY")
  [[ -n $model ]] || fail "GET /api/models gives a defaultModel" "$BODY"
  call POST "$BASE/api/models" 30 '{}'
  expect_status "POST /api/models returns 405" 405
  reject_checks /api/compare
  call POST "$BASE/api/judge" 30 '{}'
  expect_status "POST {} /api/judge returns 400" 400
  expect "POST {} /api/judge error is a non-empty string" '.error | type == "string" and length > 0'
  [[ -n $model ]] || return 0
  call POST "$BASE/api/compare" 30 "$(jq -nc --arg m "$model" '{prompt: "Reply with exactly the word READY.", models: ["~anthropic/claude-haiku-latest", $m, $m]}')"
  expect_status "compare returns 200" 200
  expect "keys: runId totalMs panels trace summary" "$(has_keys runId totalMs panels trace summary)"
  expect "a panel answer contains READY" 'any(.panels[]; (.text // "") | contains("READY"))'
}

app_07() {
  local topic='Why unit tests matter for small teams' sources
  reject_checks /api/ai
  expect "POST {} /api/ai retryable is a boolean" '.retryable | type == "boolean"'
  # Research needs the Sources output, so the pipeline's first stage runs first. It makes no model call.
  call POST "$BASE/api/ai" 60 "$(jq -nc --arg t "$topic" '{topic: $t, contentType: "Blog Post", stage: "sources", context: {}}')"
  expect_status "sources stage returns 200" 200
  expect "sources result is a non-empty string" '.result | type == "string" and length > 0'
  sources=$(jq -r '.result // empty' 2>/dev/null <<<"$BODY")
  call POST "$BASE/api/ai" 60 "$(jq -nc --arg t "$topic" --arg s "$sources" '{topic: $t, contentType: "Blog Post", stage: "research", context: {sources: $s}}')"
  expect_status "research stage returns 200" 200
  expect "keys: result trace usage model totalMs" "$(has_keys result trace usage model totalMs)"
  expect "result is a string of at least 20 words" '.result | type == "string" and ([scan("\\S+")] | length >= 20)'
  expect "model is a non-empty string" '.model | type == "string" and length > 0'
}

app_08() {
  reject_checks /api/ai
  expect "POST {} /api/ai has trace and totalMs" "$(has_keys trace totalMs)"
  call POST "$BASE/api/ai" 30 "{\"image\":\"$VISION_PNG\",\"mediaType\":\"image/png\",\"mode\":\"describe\"}"
  expect_status "vision stream returns 200" 200
  expect_type text/event-stream
  expect_sse "complete frame has stage, result, trace, usage, servedModel, totalMs" "frame(\"stage\"; \"complete\") | $(has_keys stage result trace usage servedModel totalMs)"
  expect_sse "complete frame has non-empty result and servedModel" 'frame("stage"; "complete") | (.result | type == "string" and length > 0) and (.servedModel | type == "string" and length > 0)'
  expect_sse "stream ends with [DONE]" 'sse_done'
}

# app-09 explains npm download figures: /api/explain takes the figures the browser computed, /api/releases lists release days.
EXPLAIN_REQ='{"target":"left-pad","names":["left-pad"],"window":{"name":"the past month","runDate":"2026-11-06","L":"2026-11-05","days":30,"start":"2026-10-07","noData":[],"past":["2026-10-07","2026-11-05"],"before":["2026-09-07","2026-10-06"]},"facts":[{"name":"left-pad","aggregates":{"windowTotal":"3000000","last30Total":"3000000","peakDay":"2026-10-20","peakValue":150000,"growth":{"S1":"1500000","n1":15,"S0":"1400000","n0":15,"computable":true}},"unusual":[],"possibleGaps":[],"notAssessed":[]}],"pastRows":{"left-pad":[["2026-11-03",100000,null],["2026-11-04",101000,null],["2026-11-05",99000,null]]},"releaseState":{"left-pad":"ok"}}'

app_09() {
  reject_checks /api/explain
  call GET "$BASE/api/releases" 30
  expect_status "GET /api/releases without a name returns 400" 400
  expect "GET /api/releases error is a non-empty string" '.error | type == "string" and length > 0'
  call POST "$BASE/api/releases?name=left-pad" 30 '{}'
  expect_status "POST /api/releases returns 405" 405
  call GET "$BASE/api/releases?name=left-pad" 30
  expect_status "GET /api/releases?name=left-pad returns 200" 200
  expect "keys: name status releases" "$(has_keys name status releases)"
  expect "status is ok or failed and releases is an array" '(.status | IN("ok", "failed")) and (.releases | type == "array")'
  call POST "$BASE/api/explain" 60 "$EXPLAIN_REQ"
  expect_status "explanation returns 200" 200
  expect "ok is true" '.ok == true'
  expect "paragraph is a non-empty array" '.paragraph | type == "array" and length > 0'
  expect "servedModel is a non-empty string" '.servedModel | type == "string" and length > 0'
}

app_10() {
  reject_checks /api/ai
  call POST "$BASE/api/ai" 30 '{"task":"Open google.com and report the page title."}'
  expect_status "plan returns 200" 200
  expect "keys: result trace usage model totalMs" "$(has_keys result trace usage model totalMs)"
  expect "result.steps is a non-empty array" '.result.steps | type == "array" and length > 0'
  expect "first step has an action string" '.result.steps[0].action | type == "string" and length > 0'
  expect "model is a non-empty string" '.model | type == "string" and length > 0'
  reject_checks /api/execute
}

app_11() {
  reject_checks /api/run
  expect "POST {} /api/run error is the question message" '.error == "The request needs a question field with text."'
  call POST "$BASE/api/run" 60 '{"question":"Who founded the city of Lisbon, according to Wikipedia?"}'
  expect_status "research run returns 200" 200
  expect_type text/event-stream
  expect_sse "first frame is run_start with a runId" 'frame("type"; "run_start") | (.runId | type == "string" and length > 0)'
  expect_sse "result frame has an answer, ending, sources, totals and models" "frame(\"type\"; \"result\") | $(has_keys answer ending sources totals models)"
  expect_sse "result ending.kind is complete, partial or no_answer" 'frame("type"; "result") | .ending.kind | IN("complete", "partial", "no_answer")'
  expect_sse "stream ends with [DONE]" 'sse_done'
}

# app-12 starts real triage threads that persist in Netlify Blobs, so the suite only checks the endpoints
# that refuse bad input and the thread list. It never starts a run.
app_12() {
  reject_checks /api/start
  expect "POST {} /api/start error asks for the GitHub issue" '.error == "Send the GitHub issue to triage."'
  call GET "$BASE/api/threads" 30
  expect_status "GET /api/threads returns 200" 200
  expect "keys: success storage threads" "$(has_keys success storage threads)"
  expect "threads is an array" '.threads | type == "array"'
  reject_checks /api/resume
}

# app-13 is two requests: /api/run extracts key points and ends with a signed handoff frame; /api/synthesize takes the text and that handoff and writes the summary.
app_13() {
  local text="When in the Course of human events, it becomes necessary for one people to dissolve the political bands which have connected them with another, and to assume among the powers of the earth, the separate and equal station to which the Laws of Nature and of Nature's God entitle them, a decent respect to the opinions of mankind requires that they should declare the causes which impel them to the separation."
  local handoff
  reject_checks /api/run
  expect "POST {} /api/run error asks for a text field" '.error == "Send a JSON object with a text field."'
  reject_checks /api/synthesize
  call POST "$BASE/api/run" 60 "$(jq -nc --arg t "$text" '{text: $t}')"
  expect_status "extract run returns 200" 200
  expect_type text/event-stream
  expect_sse "handoff frame carries the signed key points" 'frame("type"; "handoff") | .handoff | type == "object"'
  expect_sse "stream ends with [DONE]" 'sse_done'
  handoff=$(jq -Rsc "$SSE_DEFS frame(\"type\"; \"handoff\").handoff // empty" <<<"$BODY" 2>/dev/null)
  if [[ -z $handoff ]]; then fail "run gave a handoff to synthesize from"; return 0; fi
  call POST "$BASE/api/synthesize" 60 "$(jq -nc --arg t "$text" --argjson h "$handoff" '{text: $t, handoff: $h}')"
  expect_status "synthesize returns 200" 200
  expect_type text/event-stream
  expect_sse "result frame has summary, coverage, chunkCount and metrics" "frame(\"type\"; \"result\") | .result | $(has_keys summary coverage chunkCount metrics)"
  expect_sse "stream ends with [DONE]" 'sse_done'
}

###############################################################################
# Runner
###############################################################################

# run_app NN: the frontend checks, then the app's own checks.
run_app() {
  local nn=$1
  CURRENT="app-$nn"
  ORIGIN="https://jdgafx-app-$nn-${SLUG[$nn]}.netlify.app"
  BASE=$ORIGIN
  if [[ $MODE == local ]]; then BASE=http://localhost:8888; fi
  printf '\n%b━━━ app-%s %s ━━━%b\n' "$CYAN" "$nn" "${SLUG[$nn]}" "$NC"
  check_frontend
  "app_$nn"
}

summary() {
  printf '\n%b━━━ RESULTS ━━━%b\n' "$CYAN" "$NC"
  printf '  %bPassed: %s%b\n' "$GREEN" "$PASS" "$NC"
  printf '  %bFailed: %s%b\n' "$RED" "$FAIL" "$NC"
  printf '  Total:  %s\n' "$((PASS + FAIL))"
  if (( FAIL > 0 )); then
    printf '\n%bFailed checks:%b\n' "$RED" "$NC"
    for line in "${FAILED[@]}"; do printf '  %b✗%b %s\n' "$RED" "$NC" "$line"; done
    exit 1
  fi
  printf '\n%bAll checks passed.%b\n' "$GREEN" "$NC"
}

main() {
  local arg=${1:-} nn
  local -a apps=(01 02 03 04 05 06 07 08 09 10 11 12 13)
  case $arg in
    '') ;;
    local) MODE=local ;;
    app-[0-9][0-9])
      nn=${arg#app-}
      [[ -n ${SLUG[$nn]-} ]] || { echo "Unknown app: $arg" >&2; exit 1; }
      apps=("$nn") ;;
    *) echo "Usage: $0 [local|app-NN]" >&2; exit 1 ;;
  esac
  printf '\n%bPortfolio apps smoke suite, mode: %s%b\n' "$CYAN" "$MODE" "$NC"
  for nn in "${apps[@]}"; do run_app "$nn"; done
  summary
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
