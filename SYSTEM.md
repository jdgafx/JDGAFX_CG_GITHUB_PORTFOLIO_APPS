# SYSTEM: the portfolio, its failures, and the fix set

Status: **DRAFT for supervisor approval.** No fix round starts until the supervisor approves this plan. Written 2026-10-11 from evidence in this repo and in `~/dev/CC-MAESTRO/reviews/portfolio-review/` (the earlier analysis). Every claim names its source. Items marked **[unverified]** are analyst estimates, not measured here.

## 1. Goal (2 lines)

Thirteen working AI applications (`app-01` to `app-13`) and the n8n automations in `n8n-automations/`, each on real data, with clean code, tests and a README, so a hiring developer can run and read them.
An app is **done** only when a clean-context live run on real data passes the SP2 checklist (section 2) and the evidence sits in `.acceptance/`.

## 2. What "done" means, per component

Each row is one checkable sentence. "On file" means the evidence exists in `.acceptance/dw/es/` now.

| Component | Done means (checkable) | On file today |
|---|---|---|
| app-01 AgentFlow | A citation audit on a live run gives the right verdict for each cited claim, checked against the fetched source, and the SP2 checklist is 8 of 8 | No SP2 evidence. Last verifier FAIL (8 FAIL reports) |
| app-02 DocMind | Live Wikipedia or arXiv question returns cited answers whose markers match the passages shown, and SP2 8 of 8 | No SP2 evidence |
| app-03 CodeLens | Live GitHub file review flags only claims the file can confirm, with the false-claim rate at zero on a fixed sample, and SP2 8 of 8 | No SP2 evidence. Last FAIL on record (3 of 45 wrong) |
| app-04 VoxAI | A typed or spoken question gets a live weather or Wikipedia answer with no "Let me check" text and no empty answer, and SP2 8 of 8 | Uncommitted tree (48 paths), not verified |
| app-05 DataPilot | Live USGS or Open-Meteo question returns the value the source gives (checked by hand), and SP2 8 of 8 | **Accepted under SP2 8 of 8** (`.acceptance/dw/es/app-05-sp2/`, `app-05-fix3-2026-10-10/`) |
| app-06 ModelArena | Votes are stored one record each and the leaderboard matches them, with no test votes left in production | No SP2 evidence. Test votes purge pending (section 5, C7) |
| app-07 ContentForge | Every citation in a generated piece links to a live source that says it, with no 404 source, and no auto-run on first load | Uncommitted tree (30 paths), cause of the auto-run not found |
| app-08 VisionLab | Commons picks load and the pick error clears on a new image, and SP2 8 of 8 | No SP2 evidence |
| app-09 InsightHub | Every figure in a summary matches the npm data by hand, and the figure check's verdicts match the hand check on a fixed sample | Uncommitted tree (43 paths), 24 tests failing |
| app-10 BrowseBot | The trace total equals the sum of its rows, the idle chip names the providers, and the run is repeated 10 times with no failure | Uncommitted tree (34 paths) |
| app-11 GraphScout | A live run cites every answer sentence, the served model is the newest Haiku, and SP2 8 of 8 | Tool-choice fix and guard committed `7aca059`; one live round of 5 runs on file in `.acceptance/dw/es/app-11-toolchoice-2026-10-11/`. Still **REJECT** on its earlier Lows |
| app-12 GraphGate | Live GitHub issues triage, the approval card fits 390 px, and the public thread list shows no test fixtures | Uncommitted tree (54 paths). Token and purge decisions open |
| app-13 GraphSwarm | A live Wikipedia summary completes inside the platform time limit with every chunk extracted, and SP2 8 of 8 | Price logic verified by hand; six Lows open. **REJECT** |
| n8n workflows 01 to 05 | Each live workflow's model call names the newest Haiku or Sonnet in its response, and each run completes | Files and live instance synced (`96fbf04`). Captured ids for 01, 02 (both nodes), 03 and 05 are the newest. **Live runs not done**: the n8n OpenRouter credential returns 402 (`Insufficient credits`) |

Count: **one** app (05) is accepted. Everything else is not done.

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
- Commits: path-scoped (`git add -- <app>`, `git commit -- <app>`), `git push origin HEAD:main`. No Co-Authored-By and no Claude-Session trailer on any commit.
- Writing: never "hacked" (say "compromised"). Drafts only for messages and forms; nothing sent.

## 5. Root causes of the repeated fix commits

Count: **223 commits in the last 3 days**. **65** subjects begin with `fix` (Chris's brief says about 78; the difference is the prefix rule and is not resolved here). Fix-like subjects are common across the rest, such as "live-data chip fixes from the live check".

Verifier history from `~/dev/CC-MAESTRO/reviews/portfolio-review/c-incidents.md`: **87 independent verifier reports, 27 PASS, 60 FAIL**; 11 of 13 apps flip from PASS back to FAIL.

| # | Failure class | Evidence (verified here unless marked) | Mechanism | Structural fix (not a per-app patch) |
|---|---|---|---|---|
| C1 | **Silent provider fallback accepted as success.** The app asks for one model and another answers | Captured streams: `.acceptance/dw/es/app-11-langgraph-research-agent-sp1/response.sse` and `app-11-acceptance-2026-10-10/api/run1-eiffel.sse.txt` (and 8 more) each show 2 rows `claude-haiku-4.5` for the two forced-tool agent rounds, and the rest `claude-haiku-5.5`. Direct test this session, same alias, `max_tokens` 64: `tool_choice: required` served `anthropic/claude-haiku-4.5` with 1 tool call; `tool_choice: auto` served `anthropic/claude-haiku-5.5` with 1 tool call (`.acceptance/dw/es/n8n-model-sync-2026-10-11/capture-toolchoice-*.json`). Single sample per setting. Commit trail: `00ca3c1` (pinned id), `aea0b06`/`f1fa360` (alias), `1b9edb9`, `3e52d7a`, `f3e26ef` (Haiku 5.5 on every node), `890f0a9` (price for 4.5). n8n: 01 and 05 hardcoded 4.5, 03 hardcoded Sonnet 4.6 (`96fbf04`) | Forced tool choice on the alias is routed to an older Haiku. The app did not check the served model against the newest | Shared model module: one call function, served-model guard that refuses any model other than the newest the list resolves the alias to, `tool_choice` fixed to `auto`, and a repo-wide test that fails on any pinned model id. Done in app-11 (`7aca059`) as the prototype |
| C2 | **Stale notes, READMEs and docs contradict the code** | `424eee7`, `f93505f`, `280a0fd`, `d3841fd` (README and page model wording, app count); `7f99d3e` (docs said Tailwind; no app uses it); `4e26f5e` (internal audit note committed by mistake); CC-MAESTRO SYSTEM section 7 lists 9 conflicts (RESUME said "pin 5.5"; app counts "10"). This session: 4 n8n docs still said 4.5 or 4.6 (`96fbf04`) | Notes were written from memory or an earlier state and never re-checked against the code | One claims check: README and doc model names, app counts and prices are generated from or tested against the code. Retire the duplicate handoff notes |
| C3 | **Per-app copies of shared code, so each defect is fixed 13 times** | Identical copies, verified: `tokens.css`, `components.css`, `markdown.ts` (13 apps each); `deadline.ts` (9 apps); `useResultFocus.ts` (12 apps). Divergent: `shortModel` in 9 files; "Ready" chip in 11 files. Commit subjects in the window: "live-data chip" (32), "design system v2/v3/v3.1/v3.2/v3.3" (30), "How to use ... Try it button" (9 identical commits, one per app: `50c67b7`, `77dccea`, `a0dfc5e`, `e6a0083`, `569b025`, `52b3f53`, `8678de1`, `be70465`, `6114458`) | Copy-paste per app, no shared package | SP3: one shared package (tokens, components, markdown, deadline, result focus, chip, model-name helper, how-to block). One app, then fan out. A test that fails when any app holds a private copy |
| C4 | **Regex and word lists used as checks on model prose (symptom patches)** | Regex word-list files: 9 apps, 28 files (app-03 7, app-09 8, app-11 3, app-12 3, app-05 2, app-10 2, apps 01, 04, 07 one each). Commit subjects: `8124e9c` ("remove the word-pair reversal check"), `2fb42c6` ("drop comments whose last word is that the code is fine"), `4db9027` ("caught in any voice"), `94719c2` ("text aimed at an AI always pauses"), `8d5ff0d` ("no verdict is ever raised in code"). App-12 `reply-guard.ts` lines 7, 8, 66 are regex phrase lists. SYSTEM (CC-MAESTRO) P2 counts 20 of 78 fix commits adding lists [unverified] | Each new phrasing needed a new entry | Replace each list with a structured output (the model returns a typed verdict with quoted spans) and a deterministic check on those spans. Delete the list. Per app, in order of fix count (09, 03, 05, 12, 01) |
| C5 | **Acceptance bar moved by the verifier** | `c-incidents.md`: app-09 FAIL 9 of 10, each report a new probe; app-03 false-claim rate 10/85, 6/32, 3/45 (bar moved 11.8%, 18.8%, 6.7%). Decision commit `4062c9e` ("no more than N" upper bound) | No frozen checklist | SP2: one fixed 8-point checklist (section 6). Verifiers apply it only; a new defect class needs the supervisor's approval |
| C6 | **Green gates, failing live. Fixes "done" on unit tests** | `c-incidents.md`: 60 of 87 verifier reports FAIL; 12 of 87 reports say a claimed fix was not fixed. Example: app-10 totals fixed in 4 commits in 2 hours (`87171bd`, `799448e`, `5c2c2a5`, `3a12077`) | Tests restated the symptom | SP1: live capture before commit. Every new test must fail when its fix is reverted (mutation check, done for app-11: five guards, five failing tests) |
| C7 | **Live checks write to production** | RESUME: 88 app-12 threads owned by `verifier-probe` (2,096 keys), 7 unclassified threads, 23 `react/react` threads; app-06 test votes; 402 credit errors in live runs. Backups in `~/backups/portfolio-sp5-2026-10-10/` | Checks run against the production store | SP5: local `netlify dev` with emulated Blobs for every check; purge after backup. **Purge decision is Chris's** |
| C8 | **Time budgets and platform cut-offs re-fixed per app** | Commit subjects in the window matching retry, timeout, deadline, cut-off, time limit: 22. Examples: app-11 `04f4aa6`, `1027be5`; app-13 `f53a3d8`, `1b9edb9`; app-07 `dfb55db`; app-12 `3e52d7a`; app-10 `de04d43`. Shared `deadline.ts` is identical in 9 apps; apps 09, 11, 12 and 13 have no shared copy and their own time logic | Each app sets its own limits by trial against the live platform | One shared deadline and retry module, measured limits per platform in one place, and a captured slow-run check per app |
| C9 | **Commits span apps or drop work by mistake** | Commits touching several app areas in the window: `00ca3c1` (9 areas), `8ebb4b0` (5), `5cff9aa`, `49f64ba`, `37add74`, `7b6db9f`, `2d2f325`, `60d84f4`, `8ac4877` (2 each). Mistakes: `5ec20d7` (restore `speech.ts` removed in `49f64ba`), `4e26f5e` (audit note committed by mistake) | No commit-scope check | Pre-commit check: a commit may touch one app, or a shared path if the commit is marked fan-out. Deleted files are listed in the commit message |
| C10 | **Model id and rule churn** | `00ca3c1` pinned `claude-haiku-5.5`; then the alias (`aea0b06`, `f1fa360`, `ca545fb`, `42ecb15`, `ee0feec`, `87cfb53`, `3b492f7`); RESUME still said "pin" until this session. Seven apps still had the string "claude-haiku-5.5" in source (CC-MAESTRO SYSTEM section 2) | Rules changed mid-flight, no check for stale ids | The repo-wide pinned-id test from C1. Rule changes only through the supervisor file |

## 6. The SP2 checklist (the one acceptance bar)

For each app, all eight points, evidence saved under `.acceptance/dw/es/<app>-<date>/`:
1. Tree clean and pushed; the served bundle matches the build.
2. Lint, typecheck, tests and build pass; no mock data in `src/` or `netlify/`.
3. Cold visit at 1440 and 390: task line, directions and an idle "Live data: <source>" chip above the fold.
4. Run the example from the directions alone: request and response captured, chip lights, served model shown.
5. Three values checked by hand against the source.
6. Block the fetch and the model: clear error, "unavailable" chip, no substitute data.
7. Three runs in a row (ten for app-10), reload and double submit.
8. Design screenshots at 1440, 1280 and 390 px in light and dark.

## 7. The ordered fix set

Each step names the check that would have failed before the fix. Effort is an estimate from this session's work (app-11 tool-choice round: about one session).

| Order | Fix | Covers | Verification that fails before the fix | Effort |
|---|---|---|---|---|
| 1 | Shared model module (call, served-model guard, `auto` only, repo-wide pinned-id test). Land in app-11 as the reference, then the 13 apps and the n8n guard | C1, C10 | Served-model tests (`graph.test.ts` (f), (j2), (j3)); mutation of the guard fails; repo grep test on pinned ids | Medium: one module, 12 adoptions, one live run each |
| 2 | Shared UI and server package (SP3): tokens, components, markdown, deadline, result focus, chip, model-name helper, how-to block. Start with `tokens.css` (identical today, so no visual change) | C3, C8 | "No private copy" test: fails on any app file whose hash differs from the package | Large but mechanical, after one app passes SP2 |
| 3 | Structured verdicts replace word lists, starting with app-09 then 03, 05, 12, 01 | C4 | A paraphrase or capital-letter variant the old list missed: the new check gets it right; reinstating the list makes the test fail | Large per app; four apps |
| 4 | Commit-scope check and the fan-out marker | C9 | A commit touching two apps is refused in a scratch repo | Small |
| 5 | Claims check for docs and READMEs (models, app counts, prices); delete duplicate handoff notes | C2 | The check fails on the current `docs/` 4.5 and 4.6 text (already reproduced this session) | Small |
| 6 | Local-only live checks (SP5) and the purge | C7 | A check run with production env is refused; purge needs Chris's decision | Small code, decision-bound |
| 7 | Frozen SP2 checklist file and acceptance script writing evidence; verifiers apply only this | C5, C6 | A verifier probe outside the checklist is rejected by the script | Medium |
| 8 | Finish or park the five dirty trees (04, 07, 09, 10, 12) under the new order, not as separate fix rounds | C6 | Each tree passes SP1 and SP2 or is moved to a branch | Per app |
| 9 | n8n: live runs for 01, 02, 03, 05 once the credential has credit, and a served-model check node in each workflow | C1 (n8n) | A run that names a 4.x id fails the check node | Small, blocked on credit (Chris) |

Dependencies: 1 before 2 and 3 (they use the same call path); 2 before the per-app fan-out; 7 before any verifier round. Items 6 and 9 need Chris (purge, credit).

**Not in this plan:** the app-11 Lows (D1 critic, tooltips, time after Stop) and app-13 Lows. They are handled inside items 1 and 3 when those apps are reached, not as separate rounds.

## 8. Open decisions (Chris)

1. Purge of the 88 `verifier-probe` threads in app-12 (after backup).
2. Add credit to, or re-point, the n8n OpenRouter credential (`ZbDfo...`, shared by 01, 02, 03, 05). Blocks live runs.
3. The GitHub token for app-12 (sign-in needed).
4. Foundever application and the stray Gmail draft (job search, not portfolio).

## 9. Advisor review

(Filled in after the Opus advisor pass: the objections accepted and rejected, each with a reason.)

## 10. How this file stays true

Update section 2 and section 5 with each commit that changes a status. The file is the single document for the portfolio; the earlier document in `~/dev/CC-MAESTRO/projects/portfolio/SYSTEM.md` is the supervisor's and is not edited here. Keep this file under 250 lines.
