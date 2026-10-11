# SYSTEM: the portfolio, its failures, and the fix set

Status: **DRAFT for supervisor approval.** No fix round starts until the supervisor approves this plan. Written 2026-10-11 from evidence in this repo and in `~/dev/CC-MAESTRO/reviews/portfolio-review/` (the earlier analysis). Every claim names its source. Items marked **[unverified]** are analyst estimates, not measured here.

## 1. Goal (2 lines)

Thirteen working AI applications (`app-01` to `app-13`) and the n8n automations in `n8n-automations/`, each on real data, with clean code, tests and a README, so a hiring developer can run and read them.
An app is **done** only when a clean-context live run on real data passes the SP2 checklist (section 2) and the evidence sits in `.acceptance/`.

## 2. What "done" means, per component

Each row is one checkable sentence. "On file" means the evidence exists in `.acceptance/dw/es/` now.

| Component | Done means (checkable) | On file today |
|---|---|---|
| app-01 AgentFlow | The citation audit's verdict on each cited claim matches a hand verdict written into the evidence file before the run (3 claims per live run), and SP2 8 of 8 | No SP2 evidence. Last verifier FAIL (8 FAIL reports) |
| app-02 DocMind | Live Wikipedia or arXiv question returns cited answers whose markers match the passages shown, and SP2 8 of 8 | No SP2 evidence |
| app-03 CodeLens | Live GitHub file review flags only claims the file can confirm: zero false claims on the frozen sample (file list and count fixed in `config/sp2-samples/app-03-ai-code-review.json` before any run), and SP2 8 of 8 | No SP2 evidence. Last FAIL on record (3 of 45 wrong) |
| app-04 VoxAI | A typed or spoken question gets a live weather or Wikipedia answer with no "Let me check" text and no empty answer, and SP2 8 of 8 | Uncommitted tree (48 paths), not verified |
| app-05 DataPilot | Live USGS or Open-Meteo question returns the value the source gives (checked by hand), and SP2 8 of 8 | **Accepted under SP2 8 of 8** (`.acceptance/dw/es/app-05-sp2/`, `app-05-fix3-2026-10-10/`) |
| app-06 ModelArena | Votes are stored one record each, the leaderboard matches them, no test votes remain in production (read-only check, section 8), and SP2 8 of 8 | No SP2 evidence. Test votes purge pending (section 5, C7) |
| app-07 ContentForge | Every citation in a generated piece links to a live source that says it, no 404 source, no auto-run on first load, and SP2 8 of 8 | Uncommitted tree (30 paths), cause of the auto-run not found |
| app-08 VisionLab | Commons picks load and the pick error clears on a new image, and SP2 8 of 8 | No SP2 evidence |
| app-09 InsightHub | Every figure in a summary matches the npm data by hand, the figure check's verdicts match the hand check on the frozen sample, and SP2 8 of 8 | Uncommitted tree (43 paths), 24 tests failing |
| app-10 BrowseBot | The trace total equals the sum of its rows, the idle chip names the providers, the run is repeated 10 times with no failure, and SP2 8 of 8 (10 runs in item 7) | Uncommitted tree (34 paths) |
| app-11 GraphScout | A live run cites every answer sentence, the served model is the newest Haiku, and SP2 8 of 8 | Tool-choice fix and guard committed `7aca059`; one live round of 5 runs on file in `.acceptance/dw/es/app-11-toolchoice-2026-10-11/`. Still **REJECT** on its earlier Lows |
| app-12 GraphGate | Live GitHub issues triage, the approval card fits 390 px, the public thread list shows no test fixtures (read-only check, section 8), and SP2 8 of 8 | Uncommitted tree (54 paths). Token and purge decisions open |
| app-13 GraphSwarm | A live Wikipedia summary completes inside the 30 s platform cut-off (run budget 23 s, `pipeline.ts:15`) with every chunk extracted, and SP2 8 of 8 | Price logic verified by hand; six Lows open. **REJECT** |
| n8n workflows 01 to 05 | Each live workflow's model call names the newest Haiku or Sonnet in its response (checked against the dated list snapshot), and the run's output fields match a fixture written before the run | Files and live instance synced (`96fbf04`). Captured ids for 01, 02 (both nodes), 03 and 05 are the newest. **Live runs not done**: the n8n OpenRouter credential returns 402 (`Insufficient credits`) |

Count: **one** app (05) is accepted. Everything else is not done.

**Definitions used by the checks** (apply to every row):
- **Newest model:** the `alias_target` of `~anthropic/claude-haiku-latest` (or `-sonnet-latest`) in OpenRouter's public list, saved as a dated copy (`openrouter-models-<date>.json`) in each run's evidence folder. A run without the copy is not evidence.
- **Served bundle matches the build:** the JS and CSS asset names in the deployed `index.html` equal those in the local `dist/index.html` from the same commit.
- **Above the fold:** visible in the first screen at 1440x900 (desktop) and 390x844 (phone).
- **Platform cut-off:** 30 s, the figure in `c-incidents.md`. Each app's run budget must sit under it.

## 3. Shared mechanisms (what each app re-implements)

- **OpenRouter model call.** Each app has its own call code. Every app calls `~anthropic/claude-haiku-latest` (or the Sonnet alias in n8n 02/03). Source: `grep -rl openrouter.ai/api`, 13 apps, one or two files each. Served-model handling differs by app (app-11 and app-06 have the most).
- **Tool choice.** Only app-11 sent `tool_choice: required` (`nodes.ts:158`, fixed in `7aca059`). App-04 sends `none` only (`stream.ts:157`). Apps 07, 09, 10, 12 and 13 send no `tool_choice`.
- **Pricing.** Apps 11 and 13 read OpenRouter's live list (`parsePriceBook`, `alias_target`). Apps 02 and 06 have a price match in text only; not verified. The rest have no price code.
- **Guards.** Served-model guard: app-11 only (`7aca059`). Regex word-list checks on model prose: 9 apps, 28 files (section 5, C4).
- **Deadline and retries.** `deadline.ts` is byte-identical in apps 01 to 08 and 10 (9 apps). App-09 has no deadline module. Apps 11, 12 and 13 have their own time logic in 9 to 11 files each.
- **Front end.** `tokens.css`, `components.css`, `markdown.ts` are byte-identical in all 13 apps. `useResultFocus.ts` is identical in 12 apps (app-12 differs). `shortModel` is implemented in 9 files. "Ready" status chips in 11 files.
- **Acceptance harness.** SP1 (live capture) and SP2 (checklist, section 6). Scripts under `.acceptance/`, evidence gitignored.
- **Deploy.** Netlify, one site per app (`jdgafx-app-NN-<slug>`). A monorepo site cancels a build with no content change. An env-var change needs a new deploy. Clear-cache deploy first, then an empty commit, never a local tree straight to production (supervisor decision 4(b)).

## 4. Rules in force

- SP1: a change counts only after one live run on real data with the request and response saved to a file. Unit tests are never the proof.
- SP2: the 8-point checklist (section 6). Verifiers apply it and do not invent probes.
- SP3: shared code moves to one package (tokens, components, markdown, deadline, result focus, chip, model-name helper). One app first, then fan out.
- SP4: on the second failure of the same defect, a captured trace before any further patch. Third attempt: stop patching, trace the root cause.
- SP5: fixtures and test votes are purged from production after a backup. Live checks use a local `netlify dev` with emulated Blobs.
- SP6 and SP7 (from the earlier doc): rule changes only with Chris's words. The tripwire counts unprefixed fix commits.
- Global rule (`~/.claude/CLAUDE.md`, "Remediation and repair"): zoom out before planning a fix; find the root cause with evidence; no phrase lists, retries or special cases on a symptom; a green test proves one behaviour; batch the fixes; third attempt means stop and trace.
- Model: family alias means the latest release. Never pin a version. Served-model shown in the UI.
- Commits: path-scoped (`git add -- <app>`, `git commit -- <app>`). No Co-Authored-By and no Claude-Session trailer on any commit.
- Preview-first gate (step 2, in force 2026-10-11): an app change goes to its own branch and PR; the Netlify deploy preview is the SP2 target; the verifier writes `.acceptance/gate/<app-dir>/<full-sha>.json` (`app`, `sha`, `verdict`, `preview_url`, `checklist` 1..8, `sample_sha256`). Merge to `main` only by a local fast-forward push, which runs `scripts/preview-gate.sh` through `.githooks/pre-push`. Setup per clone: `git config core.hooksPath .githooks`. Never `--no-verify`, never merge in the GitHub UI (both skip the hook). Pushes touching no `app-NN-*` path pass with `GATE SKIP`.
- Writing: never "hacked" (say "compromised"). Drafts only for messages and forms; nothing sent.

## 5. Root causes of the repeated fix commits

Count: **224 commits in the last 3 days** (`git log --since='3 days ago'`, recounted 2026-10-11; one commit landed during the review). **65** subjects begin with `fix` (Chris's brief says about 78; the difference is the prefix rule and is not resolved here). Fix-like subjects are common across the rest, such as "live-data chip fixes from the live check".

Verifier history from `~/dev/CC-MAESTRO/reviews/portfolio-review/c-incidents.md`: **87 independent verifier reports, 27 PASS, 60 FAIL**; 11 of 13 apps flip from PASS back to FAIL.

| # | Failure class | Evidence (verified here unless marked) | Mechanism | Structural fix (not a per-app patch) |
|---|---|---|---|---|
| C1 | **Silent provider fallback accepted as success.** The app asks for one model and another answers | Captured streams: `.acceptance/dw/es/app-11-langgraph-research-agent-sp1/response.sse` and `app-11-acceptance-2026-10-10/api/run1-eiffel.sse.txt` (and 8 more) each show 2 rows `claude-haiku-4.5` for the two forced-tool agent rounds, and the rest `claude-haiku-5.5`. Direct test this session, same alias, `max_tokens` 64: `tool_choice: required` served `anthropic/claude-haiku-4.5` with 1 tool call; `tool_choice: auto` served `anthropic/claude-haiku-5.5` with 1 tool call (`.acceptance/dw/es/n8n-model-sync-2026-10-11/capture-toolchoice-*.json`). Single sample per setting. Commit trail: `00ca3c1` (pinned id), `aea0b06`/`f1fa360` (alias), `1b9edb9`, `3e52d7a`, `f3e26ef` (Haiku 5.5 on every node), `890f0a9` (price for 4.5). n8n: 01 and 05 hardcoded 4.5, 03 hardcoded Sonnet 4.6 (`96fbf04`) | Forced tool choice on the alias is routed to an older Haiku. The app did not check the served model against the newest | Shared model module: one call function, served-model guard that refuses any model other than the newest the list resolves the alias to, `tool_choice` fixed to `auto`, and a repo-wide check that fails on any pinned model id in a call path (`scripts/check-pinned-models.sh`, added 2026-10-11; before that no such test existed; its CI job is held until step 4 lands so `main` does not go red). Guard done in app-11 (`7aca059`) as the prototype |
| C2 | **Stale notes, READMEs and docs contradict the code** | `424eee7`, `f93505f`, `280a0fd`, `d3841fd` (README and page model wording, app count); `7f99d3e` (docs said Tailwind; no app uses it); `4e26f5e` (internal audit note committed by mistake); CC-MAESTRO SYSTEM section 7 lists 9 conflicts (RESUME said "pin 5.5"; app counts "10"). This session: 4 n8n docs still said 4.5 or 4.6 (`96fbf04`) | Notes were written from memory or an earlier state and never re-checked against the code | One claims check: README and doc model names, app counts and prices are generated from or tested against the code. Retire the duplicate handoff notes |
| C3 | **Per-app copies of shared code, so each defect is fixed 13 times** | Identical copies, verified: `tokens.css`, `components.css`, `markdown.ts` (13 apps each); `deadline.ts` (9 apps); `useResultFocus.ts` (12 apps). Divergent: `shortModel` in 9 files; "Ready" chip in 11 files. Commit subjects in the window (exact subject match, recounted): "live-data chip" (12), "design system v" (26), "How to use ... Try it button" (9 identical commits, one per app: `50c67b7`, `77dccea`, `a0dfc5e`, `e6a0083`, `569b025`, `52b3f53`, `8678de1`, `be70465`, `6114458`) | Copy-paste per app, no shared package | SP3: one shared package (tokens, components, markdown, deadline, result focus, chip, model-name helper, how-to block). One app, then fan out. A test that fails when any app holds a private copy |
| C4 | **Regex and word lists used as checks on model prose (symptom patches)** | Regex word-list files: 9 apps, 28 files (app-03 7, app-09 8, app-11 3, app-12 3, app-05 2, app-10 2, apps 01, 04, 07 one each). Commit subjects: `8124e9c` ("remove the word-pair reversal check"), `2fb42c6` ("drop comments whose last word is that the code is fine"), `4db9027` ("caught in any voice"), `94719c2` ("text aimed at an AI always pauses"), `8d5ff0d` ("no verdict is ever raised in code"). App-12 `reply-guard.ts` lines 7, 8, 66 are regex phrase lists. SYSTEM (CC-MAESTRO) P2 counts 20 of 78 fix commits adding lists [unverified] | Each new phrasing needed a new entry | Replace each list with a structured output (the model returns a typed verdict with quoted spans) and a deterministic check on those spans. Delete the list. Per app, in order of fix count (09, 03, 05, 12, 01) |
| C5 | **The acceptance sample is not fixed, so measured rates are not comparable** | `c-incidents.md:87`: app-03 false-claim rate 10/85 (11.8%), 6/32 (18.8%), 3/45 (6.7%); sample sizes differ 2.6 times. These are measured, not a moving bar. app-09 FAIL 9 of 10, with new probes each round (`c-incidents.md`). Decision commit `4062c9e` ("no more than N" upper bound) | No frozen sample and no frozen checklist | SP2: one fixed 8-point checklist (section 6). Verifiers apply it only; a new defect class needs the supervisor's approval |
| C6 | **The fix reaches main and production before its live proof** | `c-incidents.md:61`: all 60 FAILs came from clean-context live runs, and no unit test, lint or typecheck was the detector (so unit tests were not the cause; an earlier draft of this file said otherwise and was wrong). `c-incidents.md:71`: a 30 to 120 minute gap between push and verifier; 12 of 87 reports are "fixed but not fixed", "regression" or "new false accept caused by this commit". Example: app-10 totals in 4 commits in 2 hours (`87171bd`, `799448e`, `5c2c2a5`, `3a12077`) | Proof comes after the push | SP1: live capture before commit. Every new test must fail when its fix is reverted (mutation check, done for app-11: five guards, five failing tests) |
| C7 | **Live checks write to production** | RESUME: 88 app-12 threads owned by `verifier-probe` (2,096 keys), 7 unclassified threads, 23 `react/react` threads; app-06 test votes; 402 credit errors in live runs. Backups in `~/backups/portfolio-sp5-2026-10-10/` | Checks run against the production store | SP5: local `netlify dev` with emulated Blobs for every check; purge after backup. **Purge decision is Chris's** |
| C8 | **Time budgets and platform cut-offs re-fixed per app** | Commit subjects in the window matching `retry|timeout|deadline|cut-off|time limit` (exact, recounted): 16 (22 with the wider `retr|hung|stall|timed` set). Examples: app-11 `04f4aa6`, `1027be5`; app-13 `f53a3d8`, `1b9edb9`; app-07 `dfb55db`; app-12 `3e52d7a`; app-10 `de04d43`. Shared `deadline.ts` is identical in 9 apps; apps 09, 11, 12 and 13 have no shared copy and their own time logic | Each app sets its own limits by trial against the live platform | One shared deadline and retry module, measured limits per platform in one place, and a captured slow-run check per app |
| C9 | **Commits span apps or drop work by mistake** | Commits touching several app areas in the window: `00ca3c1` (9 areas), `8ebb4b0` (5), `5cff9aa`, `49f64ba`, `37add74`, `7b6db9f`, `2d2f325`, `60d84f4`, `8ac4877` (2 each). Mistakes: `5ec20d7` (restore `speech.ts` removed in `49f64ba`), `4e26f5e` (audit note committed by mistake) | No commit-scope check | Pre-commit check: a commit may touch one app, or a shared path if the commit is marked fan-out. Deleted files are listed in the commit message |
| C10 | **Model id and rule churn** | `00ca3c1` pinned `claude-haiku-5.5`; then the alias (`aea0b06`, `f1fa360`, `ca545fb`, `42ecb15`, `ee0feec`, `87cfb53`, `3b492f7`); RESUME still said "pin" until this session. Seven apps still had the string "claude-haiku-5.5" in source (CC-MAESTRO SYSTEM section 2) | Rules changed mid-flight, no check for stale ids | The repo-wide pinned-id test from C1. Rule changes only through the supervisor file |

## 6. The SP2 checklist (the one acceptance bar)

For each app, all eight points, evidence saved under `.acceptance/dw/es/<app>-<date>/`. Inputs come only from the app's frozen sample `config/sp2-samples/<app-dir>.json` (3 runs x 3 hand checks; tokens READ_AT_RUN, WRITE_BEFORE_RUN, HAND_CHECK_AT_RUN, PREVIEW_URL defined in each file); the gate evidence carries that file's `sample_sha256` (`scripts/sp2-sample-hash.sh`):
1. Tree clean and pushed; the served bundle matches the build (asset names in deployed `index.html` equal those in local `dist/index.html`, same commit).
2. Lint, typecheck, tests and build pass; no mock data in `src/` or `netlify/`.
3. Cold visit at 1440x900 and 390x844: task line, directions and an idle "Live data: <source>" chip visible without scrolling.
4. Run the example from the directions alone: request and response captured, chip lights, served model shown.
5. Three values checked by hand against the source.
6. Block the fetch and the model: clear error, "unavailable" chip, no substitute data.
7. Three runs in a row (ten for app-10), reload and double submit.
8. Design screenshots at 1440, 1280 and 390 px in light and dark.

## 7. The ordered fix set (revised after the Opus advisor review, section 9)

Each step names the check that would fail before the fix. Effort is an estimate. Steps 1 to 5 are the whole plan now; the shared package and the word-list replacement are deferred until one app passes SP2 under the new flow.

| Order | Fix | Covers | Verification that fails before the fix | Effort |
|---|---|---|---|---|
| 1 (DONE 2026-10-11: local `wip/app-04` db3f045, `-07` 18bb493, `-09` 6033197, `-10` ffe3e8c, `-12` 56254ec; main clean) | **Park the dirty trees (209 paths: 04 48, 07 30, 09 43, 10 34, 12 54)** on branches `wip/app-NN`, so `main` holds no unverified work (this was step 4) | C6 | `git status --porcelain` on `main` is empty of those paths; each branch later passes SP1 and SP2 or is dropped | Small |
| 2 (gate DONE 2026-10-11; app-06/12 store isolation on PR previews) | **Preview-first gate.** Each fix goes to a branch or a Netlify deploy preview. The SP2 run happens on the preview and writes the evidence file for that commit SHA. Merge to `main` only when that file exists and says PASS. First check whether branch deploys share the production Blobs store; if they do, previews must use their own store before verifiers run | C6, C7, C9 | Today a push goes straight to `main` (`git push origin HEAD:main`, used in every commit in this plan). A check that refuses the merge without a PASS evidence file for the SHA fails on any unproven commit | Small: one script and one rule |
| 3 (DONE 2026-10-11: `config/sp2-samples/`, 13 files, Opus-reviewed) | **Frozen SP2 sample.** The fixed input list per app (questions, sources, expected values) lives in the repo. Rates are recomputed on that list only. The verifier cites checklist items by number | C5 | A rate computed on a different sample is refused by the script (the sample hash differs) | Medium: one list per app, written once |
| 4 | **Model path.** `tool_choice: auto` everywhere (done in app-11, `7aca059`). Served model shown in the UI. A mismatch is logged in the trace and shown, never silent. The pinned-id grep is scoped to the call paths and excludes catalogue data (for example app-06 `curated.ts`) | C1, C10 | Grep on the call paths finds a pinned id: fails before, passes after. Served-model tests `graph.test.ts` (f), (j2), (j3) fail when the guard is reverted (verified in app-11) | Small per app; app-11 done, 12 to go |
| 5 | **Docs claim check.** A script fails when README or docs name a model id other than the alias, or an app count other than 13. Run against `docs/` and the n8n docs | C2 | Fails on the current n8n docs 4.5 and 4.6 text (reproduced this session, before `96fbf04`) | Small |

**Later step (approved by Chris 2026-10-11, item 11):** GitHub branch protection on `main` with a required status check, once the gate runs in CI (today it is a local pre-push hook because `.acceptance/` is gitignored; GitHub UI merges and `--no-verify` skip it).

**Deferred (not in this plan):**
- Shared package (C3, C8). It starts after one app passes SP2 through the new flow.
- Word-list replacement (C4). Done inside each app when that app is reached, one structured check per app.
- n8n served-model check node (C1). Needs the n8n credential to have credit (Chris).

**Blocked on Chris:** the app-12 purge (C7), the n8n credit, the app-12 GitHub token, and the read-only production check for app-06 and app-12 (section 8, item 5).

## 8. Open decisions (Chris)

1. Purge of the 88 `verifier-probe` threads in app-12 (after backup).
2. Add credit to, or re-point, the n8n OpenRouter credential (`ZbDfo...`, shared by 01, 02, 03, 05). Blocks live runs.
3. The GitHub token for app-12 (sign-in needed).
4. Foundever application and the stray Gmail draft (job search, not portfolio).
5. May the app-06 and app-12 leftover-data checks read production (a read-only count of Blob keys, no writes)? Without it those two "done" rows cannot be checked under the local-only rule.

## 9. Advisor review

Reviewer: Opus, read-only (`opus-advisor`). Each point below is either accepted (with the change made) or rejected (with the reason).

**Accepted**
- The mechanism of C6 was missing and C6 was wrong as drafted. The push-then-verify gap (`c-incidents.md:71`) is the cause; unit tests were not the detector (`c-incidents.md:61`). Reframed in section 5, and step 1 of section 7 is the fix.
- C5 misread the data. The rates are measured on samples of 85, 32 and 45, so the real fault is an unfixed sample. Reframed, and step 2.
- Counts did not reproduce with one method. Restated with exact subject patterns: 224 commits, 65 `fix`, 12 "live-data chip", 26 "design system v", 16 retry-type subjects. Checked by me.
- Item 1's pinned-id test would catch legitimate catalogue data (app-06 `curated.ts`). Scope narrowed to call paths (step 3).
- Item 7 cannot be enforced by a script. Replaced by checklist items cited by number (step 2).
- Item 6 (local-only checks) does not stop verifiers that drive the deployed site. Replaced by the preview-first gate (step 1).
- The shared package and the word-list replacement were started too early. Deferred until one app passes SP2 under the new flow.
- Smallest set adopted: preview gate, frozen sample, model path, park dirty trees, docs check.

**Rejected**
- "The guard turns a fallback into a user failure, so drop the refusal." Rejected for now. Chris's rule is that a run on a non-newest model is not priced or accepted silently. With `auto` the known cause is gone, but the refusal stays as the guard against the next fallback. Revisit only if a live run shows `auto` falling back.
- "The guard fails open when the price list is down (`checked: false`)." Partly accepted: the trace marks it and the served model is shown, so it is visible. It is not refused, because refusing on a missing list would fail every run for a price lookup. This is a deliberate trade-off, recorded here.

**Points 4 and 5 (received)**
- Accepted: every "done" bar is now defined (sample file, dated model list, bundle and viewport methods, 30 s cut-off, the n8n output fixture). SP2 8 of 8 added to the rows for 06, 07, 09, 10 and 12.
- Accepted: move the parking of the five trees to step 1, and the preview gate to step 2, as the advisor ordered.
- Answered 2026-10-11: previews DO share production Blobs. Netlify docs: "The namespaces you make with getStore are shared across all deploys of your site" (https://docs.netlify.com/build/data-and-storage/netlify-blobs/). Only app-06 (`modelarena-arena`) and app-12 (`graphgate-checkpoints`) use Blobs. Fix: `getDeployStore` on `deploy-preview` and `branch-deploy` only, kind `blobs-deploy` in GET responses; production and unknown contexts keep `getStore`. Isolation counts only after a preview GET shows `blobs-deploy` (app-06 `/api/leaderboard` first, a pure read). Netlify settings: PR previews on 13/13, branch deploys off.
- Accepted as a Chris decision: a read-only production count for app-06 and app-12 (section 8, item 5).
- Not changed: the app-01 "who decides" issue is answered by the hand verdict written before the run; the app-13 number is the 30 s cut-off, not an invented limit.

## 10. How this file stays true

Update section 2 and section 5 with each commit that changes a status. The file is the single document for the portfolio; the earlier document in `~/dev/CC-MAESTRO/projects/portfolio/SYSTEM.md` is the supervisor's and is not edited here. Keep this file under 250 lines.
