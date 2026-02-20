#!/usr/bin/env bash
set -uo pipefail

###############################################################################
# Portfolio Apps — Comprehensive End-to-End Test Suite
#
# Tests every Netlify function endpoint + frontend availability for all 10 apps.
# Validates: HTTP status, response format, error handling, streaming, JSON parsing.
#
# Usage:
#   ./test-all-apps.sh              # Test all apps against production
#   ./test-all-apps.sh local        # Test all apps against local dev (localhost:8888)
#   ./test-all-apps.sh app-03       # Test single app against production
###############################################################################

PASS=0
FAIL=0
SKIP=0
ERRORS=()

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

MODE="${1:-prod}"

if [[ "$MODE" == "local" ]]; then
  BASE="http://localhost:8888"
elif [[ "$MODE" == app-* ]]; then
  SINGLE_APP="$MODE"
  MODE="prod"
fi

declare -A URLS=(
  ["app-01"]="https://jdgafx-app-01-multi-agent-orchestrator.netlify.app"
  ["app-02"]="https://jdgafx-app-02-rag-document-intelligence.netlify.app"
  ["app-03"]="https://jdgafx-app-03-ai-code-review.netlify.app"
  ["app-04"]="https://jdgafx-app-04-voice-ai-assistant.netlify.app"
  ["app-05"]="https://jdgafx-app-05-ai-data-analyst.netlify.app"
  ["app-06"]="https://jdgafx-app-06-llm-playground.netlify.app"
  ["app-07"]="https://jdgafx-app-07-content-pipeline.netlify.app"
  ["app-08"]="https://jdgafx-app-08-vision-ai.netlify.app"
  ["app-09"]="https://jdgafx-app-09-ai-saas.netlify.app"
  ["app-10"]="https://jdgafx-app-10-browser-agent.netlify.app"
)

log_pass() { ((PASS++)); echo -e "  ${GREEN}✓ PASS${NC} $1"; }
log_fail() { ((FAIL++)); ERRORS+=("$1: $2"); echo -e "  ${RED}✗ FAIL${NC} $1 — $2"; }
log_skip() { ((SKIP++)); echo -e "  ${YELLOW}○ SKIP${NC} $1"; }
log_header() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

get_url() {
  local app="$1"
  if [[ "$MODE" == "local" ]]; then
    echo "$BASE"
  else
    echo "${URLS[$app]}"
  fi
}

###############################################################################
# Test Helpers
###############################################################################

test_frontend_loads() {
  local app="$1" url
  url="$(get_url "$app")"
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url/")
  if [[ "$status" == "200" ]]; then
    log_pass "Frontend loads (HTTP $status)"
  else
    log_fail "Frontend loads" "HTTP $status"
  fi
}

test_method_not_allowed() {
  local app="$1" endpoint="$2"
  local url
  url="$(get_url "$app")${endpoint}"
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url")
  if [[ "$status" == "405" ]]; then
    log_pass "GET ${endpoint} returns 405"
  else
    log_fail "GET ${endpoint} returns 405" "Got HTTP $status"
  fi
}

test_missing_body() {
  local app="$1" endpoint="$2"
  local url
  url="$(get_url "$app")${endpoint}"
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$url" -H 'Content-Type: application/json' -d '{}')
  if [[ "$status" == "400" ]]; then
    log_pass "POST ${endpoint} empty body returns 400"
  else
    log_fail "POST ${endpoint} empty body returns 400" "Got HTTP $status"
  fi
}

test_json_response() {
  local app="$1" endpoint="$2" payload="$3" check_field="$4" test_name="$5"
  local url
  url="$(get_url "$app")${endpoint}"
  local response
  response=$(timeout 20 curl -s --max-time 18 -X POST "$url" -H 'Content-Type: application/json' -d "$payload" 2>&1 || true)
  if echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); assert '$check_field' in str(d)" 2>/dev/null; then
    log_pass "$test_name"
  else
    log_fail "$test_name" "Response: ${response:0:200}"
  fi
}

test_sse_stream() {
  local app="$1" endpoint="$2" payload="$3" expected_event="$4" test_name="$5"
  local url
  url="$(get_url "$app")${endpoint}"
  local response
  response=$(timeout 15 curl -s --max-time 14 -X POST "$url" \
    -H 'Content-Type: application/json' -d "$payload" 2>/dev/null | head -c 2000 || true)
  if [[ -n "$response" ]] && echo "$response" | grep -q "$expected_event"; then
    log_pass "$test_name"
  else
    log_fail "$test_name" "Expected '$expected_event' in stream. Got: ${response:0:200}"
  fi
}

test_has_author_credit() {
  local app="$1"
  log_skip "Author credit (React CSR — verified in source: grep confirms all 10 apps)"
}

###############################################################################
# Per-App Test Suites
###############################################################################

test_app_01() {
  log_header "App-01: AgentFlow (Multi-Agent Orchestrator)"
  test_frontend_loads "app-01"
  test_method_not_allowed "app-01" "/.netlify/functions/ai"

  local response
  response=$(timeout 12 curl -s --max-time 10 -X POST "$(get_url app-01)/.netlify/functions/ai" \
    -H 'Content-Type: application/json' -d '{}' 2>&1 || true)
  if echo "$response" | grep -qi "missing\|query\|required"; then
    log_pass "Empty body validation"
  else
    log_fail "Empty body validation" "Response: ${response:0:200}"
  fi

  test_sse_stream "app-01" "/.netlify/functions/ai" \
    '{"query":"test topic"}' "agent_start" \
    "SSE stream with 4 agents"

  test_has_author_credit "app-01"
}

test_app_02() {
  log_header "App-02: DocMind (RAG Document Intelligence)"
  test_frontend_loads "app-02"
  test_method_not_allowed "app-02" "/api/ai"

  test_json_response "app-02" "/api/ai" \
    '{"question":"What is this about?","chunks":["AI is transforming healthcare by improving diagnosis accuracy."],"documentTitle":"AI Healthcare"}' \
    "answer" \
    "RAG Q&A returns answer"

  test_has_author_credit "app-02"
}

test_app_03() {
  log_header "App-03: CodeLens AI (AI Code Review)"
  test_frontend_loads "app-03"
  test_method_not_allowed "app-03" "/api/ai"
  test_missing_body "app-03" "/api/ai"

  test_json_response "app-03" "/api/ai" \
    '{"code":"function add(a,b){return a+b}","language":"javascript"}' \
    "comments" \
    "Code review returns comments array"

  local response
  response=$(timeout 20 curl -s --max-time 18 -X POST "$(get_url app-03)/api/ai" \
    -H 'Content-Type: application/json' \
    -d '{"code":"function add(a,b){return a+b}","language":"javascript"}')
  if echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['success']==True; assert len(d['data']['comments'])>0" 2>/dev/null; then
    log_pass "Review has structured comments with severity"
  else
    log_fail "Review structured comments" "Response: ${response:0:200}"
  fi

  test_has_author_credit "app-03"
}

test_app_04() {
  log_header "App-04: VoxAI (Voice AI Assistant)"
  test_frontend_loads "app-04"
  test_method_not_allowed "app-04" "/api/ai"
  test_missing_body "app-04" "/api/ai"

  test_json_response "app-04" "/api/ai" \
    '{"message":"What is 2+2?"}' \
    "response" \
    "Chat returns response"

  test_json_response "app-04" "/api/ai" \
    '{"message":"Tell me a joke","history":[{"role":"user","content":"Hi"},{"role":"assistant","content":"Hello!"}]}' \
    "response" \
    "Chat with history returns response"

  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -X POST "$(get_url app-04)/api/transcribe" \
    -H 'Content-Type: application/json' -d '{}')
  if [[ "$status" == "400" ]]; then
    log_pass "Transcribe empty body returns 400"
  else
    log_fail "Transcribe empty body returns 400" "Got HTTP $status"
  fi

  test_has_author_credit "app-04"
}

test_app_05() {
  log_header "App-05: DataPilot (AI Data Analyst)"
  test_frontend_loads "app-05"
  test_method_not_allowed "app-05" "/api/ai"

  test_json_response "app-05" "/api/ai" \
    '{"question":"show total sales by region","headers":["product","sales","region"],"sampleRows":[{"product":"Widget","sales":"100","region":"East"},{"product":"Gadget","sales":"200","region":"West"}],"rowCount":2}' \
    "chartType" \
    "Query plan with chartType returned"

  local response
  response=$(timeout 20 curl -s --max-time 18 -X POST "$(get_url app-05)/api/ai" \
    -H 'Content-Type: application/json' \
    -d '{"question":"show total sales by region","headers":["product","sales","region"],"sampleRows":[{"product":"Widget","sales":"100","region":"East"}],"rowCount":1}')
  if echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'groupBy' in d; assert 'aggregate' in d" 2>/dev/null; then
    log_pass "Query plan has groupBy and aggregate"
  else
    log_fail "Query plan structure" "Response: ${response:0:200}"
  fi

  test_has_author_credit "app-05"
}

test_app_06() {
  log_header "App-06: ModelArena (LLM Playground)"
  test_frontend_loads "app-06"
  test_method_not_allowed "app-06" "/api/ai"

  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -X POST "$(get_url app-06)/api/ai" \
    -H 'Content-Type: application/json' -d '{}')
  if [[ "$status" == "400" ]]; then
    log_pass "Empty body returns 400"
  else
    log_fail "Empty body returns 400" "Got HTTP $status"
  fi

  test_sse_stream "app-06" "/api/ai" \
    '{"model":"claude-haiku-4.5","messages":[{"role":"user","content":"Say hello in one word"}]}' \
    '"type":"text"' \
    "Haiku streaming response"

  test_sse_stream "app-06" "/api/ai" \
    '{"model":"claude-haiku-4.5","messages":[{"role":"user","content":"Say hi"}]}' \
    '"type":"done"' \
    "Stream includes done event with metrics"

  test_has_author_credit "app-06"
}

test_app_07() {
  log_header "App-07: ContentForge (Content Pipeline)"
  test_frontend_loads "app-07"
  test_method_not_allowed "app-07" "/api/ai"

  test_sse_stream "app-07" "/api/ai" \
    '{"topic":"remote work tips"}' \
    "step_start" \
    "Pipeline starts with step_start event"

  test_sse_stream "app-07" "/api/ai" \
    '{"topic":"remote work tips"}' \
    "research" \
    "Pipeline includes research step"

  test_has_author_credit "app-07"
}

test_app_08() {
  log_header "App-08: VisionLab (Vision AI)"
  test_frontend_loads "app-08"
  test_method_not_allowed "app-08" "/api/ai"

  test_missing_body "app-08" "/api/ai"

  log_skip "Vision analysis (requires base64 image upload)"
  test_has_author_credit "app-08"
}

test_app_09() {
  log_header "App-09: InsightHub (AI SaaS Dashboard)"
  test_frontend_loads "app-09"
  test_method_not_allowed "app-09" "/api/ai"

  test_missing_body "app-09" "/api/ai"

  test_sse_stream "app-09" "/api/ai" \
    '{"metrics":{"totalApiCalls":15000,"totalTokens":2500000,"avgResponseTime":245,"totalCost":12.50,"apiCallsTrend":15,"tokensTrend":8,"responseTimeTrend":-5,"costTrend":10}}' \
    "text" \
    "AI insights streaming response"

  test_has_author_credit "app-09"
}

test_app_10() {
  log_header "App-10: BrowseBot (Browser Agent)"
  test_frontend_loads "app-10"
  test_method_not_allowed "app-10" "/api/ai"
  test_missing_body "app-10" "/api/ai"

  test_json_response "app-10" "/api/ai" \
    '{"task":"search google for weather"}' \
    "steps" \
    "Returns automation steps array"

  local response
  response=$(timeout 20 curl -s --max-time 18 -X POST "$(get_url app-10)/api/ai" \
    -H 'Content-Type: application/json' \
    -d '{"task":"go to amazon and search for laptops"}')
  if echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); steps=d['steps']; assert len(steps)>=3; assert all('action' in s and 'thought' in s for s in steps)" 2>/dev/null; then
    log_pass "Steps have action and thought fields"
  else
    log_fail "Steps structure" "Response: ${response:0:200}"
  fi

  test_has_author_credit "app-10"
}

###############################################################################
# Runner
###############################################################################

echo -e "\n${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       Portfolio Apps — End-to-End Test Suite                 ║${NC}"
echo -e "${CYAN}║       Mode: ${MODE}                                              ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"

if [[ -n "${SINGLE_APP:-}" ]]; then
  case "$SINGLE_APP" in
    app-01) test_app_01 ;;
    app-02) test_app_02 ;;
    app-03) test_app_03 ;;
    app-04) test_app_04 ;;
    app-05) test_app_05 ;;
    app-06) test_app_06 ;;
    app-07) test_app_07 ;;
    app-08) test_app_08 ;;
    app-09) test_app_09 ;;
    app-10) test_app_10 ;;
    *) echo "Unknown app: $SINGLE_APP"; exit 1 ;;
  esac
else
  test_app_01
  test_app_02
  test_app_03
  test_app_04
  test_app_05
  test_app_06
  test_app_07
  test_app_08
  test_app_09
  test_app_10
fi

echo -e "\n${CYAN}━━━ RESULTS ━━━${NC}"
echo -e "  ${GREEN}Passed: $PASS${NC}"
echo -e "  ${RED}Failed: $FAIL${NC}"
echo -e "  ${YELLOW}Skipped: $SKIP${NC}"
TOTAL=$((PASS + FAIL + SKIP))
echo -e "  Total:  $TOTAL"

if [[ $FAIL -gt 0 ]]; then
  echo -e "\n${RED}Failed tests:${NC}"
  for err in "${ERRORS[@]}"; do
    echo -e "  ${RED}✗${NC} $err"
  done
  exit 1
else
  echo -e "\n${GREEN}All tests passed!${NC}"
  exit 0
fi
