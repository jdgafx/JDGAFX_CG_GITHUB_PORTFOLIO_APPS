# 05 - KPI Watchdog

Scheduled metrics pull, anomaly detection against rolling history, and an LLM-written
executive digest - built to demo instantly and to survive a source going dark mid-run.

Two entry points into the same logic: a daily Schedule Trigger for production, and a
`POST /webhook/kpi-run` for on-demand demo runs. Both feed the identical downstream
pipeline, so what you see in a live demo is exactly what runs at 07:00 every day.

## Why this pattern matters (business framing)

A human "morning KPI check" - open three dashboards, eyeball the numbers, write a Slack
update - takes 10-15 minutes and gets skipped the moment someone is busy. This workflow
does it in under 5 seconds, every time, and never silently skips a source that's down.
The pay-off is not the automation itself, it's the **incident lead time**: an anomaly
that would surface in tomorrow's stand-up now surfaces the moment the metric moves,
with the "why it matters" already written by the LLM instead of left for a human to
interpret cold.

## Architecture

```mermaid
flowchart TD
    ST[Schedule Trigger - Daily] --> IC[Init Context]
    WH[Webhook: /kpi-run] --> IC
    IC --> FF{Forced Failure Test?}
    FF -->|true, test hook| THROW[Throw Forced Failure]
    FF -->|false, normal path| GH[HTTP: GitHub Stats]
    FF --> CG[HTTP: CoinGecko BTC]
    FF --> OM[HTTP: Open-Meteo Temp]

    GH --> NGH[Normalize GitHub]
    CG --> NCG[Normalize CoinGecko]
    OM --> NOM[Normalize Open-Meteo]

    NGH --> MERGE[Merge Metric Branches]
    NCG --> MERGE
    NOM --> MERGE
    MERGE --> AGG[Aggregate Metrics]

    AGG --> ENS1[Ensure kpi_history Table Exists]
    ENS1 --> HIST[Get History - kpi_history]
    HIST --> DET[Detect Anomalies]
    DET --> INS[Insert History Rows]
    INS --> PROMPT[Build Digest Prompt]
    PROMPT --> LLM[Generate Digest - Basic LLM Chain]
    OR[OpenRouter Chat Model - claude-haiku-4.5] -.model.-> LLM
    LLM --> PREP[Prepare Digest Record]
    PREP --> EXEC[Execute Workflow: 05a Adapter]
    EXEC --> ISWH{Is Webhook Run?}
    ISWH -->|yes| RESP[Respond to Webhook]
    ISWH -->|no, scheduled| NOOP[No Response Needed]

    THROW -.on error.-> CORE[[CORE] Error Handler]

    subgraph SUB[05a - Adapter: Digest Delivery]
        TRIG[Execute Workflow Trigger] --> FC{Force Crash Test?}
        FC -->|true, test hook| THROW2[Throw Forced Failure 05a]
        FC -->|false| ENS2[Ensure kpi_digests Table Exists]
        ENS2 --> DELIVER[Deliver: Data Table - swap for Slack/Email]
    end
    EXEC -.calls, onError continueRegularOutput.-> TRIG
    THROW2 -.on error, independent of parent.-> CORE
```

## Patterns used

- **Dual trigger, single pipeline.** Schedule Trigger and Webhook both feed `Init
  Context`, which normalizes the two shapes into one context object (`runTimestamp`,
  `triggerSource`, `testOverrides`). Everything downstream is trigger-agnostic.
- **Test hook, not a mock.** The webhook accepts an optional `testOverrides` body
  (`overrides`, `forceSourceDown`, `forceCrash`, `forceCrash05a`) so the anomaly path, a
  dead source, a parent-workflow crash, and an independent sub-workflow crash can all be
  proven on demand, without waiting for GitHub stars or BTC price to misbehave on their
  own. This is a real execution through the real pipeline - the override only
  substitutes the final numeric value, the outbound URL, or forces a real `throw`, it
  never fakes a node's execution.
- **Merge node for true parallel fan-in.** The three metric sources run in parallel.
  Connecting three source nodes into one destination's input index does **not** merge
  them in n8n - it fires the destination once per source (observed empirically while
  building this: `Aggregate Metrics` ran three times with one metric each until this was
  fixed). A `Merge` node (`mode: append`, 3 distinct input indices) is what actually
  forces the engine to wait for all three branches and hand them over as one item.
- **Graceful degradation, not silent omission.** Every HTTP call runs with
  `retryOnFail` (3 tries, backoff wait) and `onError: continueRegularOutput`. A dead
  source becomes `{ ok: false, error: "<real message>" }`, not a workflow crash - and
  the digest prompt is instructed to call the gap out by name rather than leave it out.
- **Rolling-mean anomaly detection.** `Detect Anomalies` pulls prior rows for each
  metric from the `kpi_history` Data Table, computes the mean, and flags a run when the
  current value deviates more than `THRESHOLD_PCT` (a single named constant, default
  15%) from that mean. Table read uses `alwaysOutputData: true` - without it, an empty
  `kpi_history` on the very first run produces zero rows, and n8n skips every downstream
  node by default, silently truncating the whole workflow.
- **Adapter sub-workflow as the one swap point.** `05a - Adapter: Digest Delivery` is
  called via Execute Workflow and does the actual delivery. Today that's a
  `kpi_digests` Data Table insert (so the demo has zero external dependencies); in
  production, only that one node changes.
- **Shared error handling, wired independently at every level.** Both `05 - KPI
  Watchdog` and `05a - Adapter: Digest Delivery` set `settings.errorWorkflow` to the
  portfolio's shared `[CORE] Error Handler` (Error Trigger -> extract clean fields ->
  insert into `core_error_log`) - not just the parent. A sub-workflow that only inherits
  error handling through its parent goes dark the moment the parent tolerates its
  failure; wiring both means a 05a failure is caught and logged as its own row
  (`workflowName: "05a - Adapter: Digest Delivery"`) even when the parent survives it.
- **Delivery failure is best-effort, not fatal.** The `Deliver Digest (05a)` Execute
  Workflow node runs with `onError: continueRegularOutput`. If 05a fails, the KPI
  analysis that already happened in 05 (metrics fetched, anomalies detected, digest
  written) is not thrown away - the run still responds successfully. The 05a failure
  itself is never swallowed: it reaches `[CORE] Error Handler` on its own, independent
  of the parent's outcome. Verified live - see execution evidence below.

## Data Tables

| Table | Written by | Columns |
|---|---|---|
| `kpi_history` | 05 - KPI Watchdog | `metric_name, source, value, ok, error_note, run_timestamp, prior_mean, prior_count, pct_change, anomaly, threshold_pct` |
| `kpi_digests` | 05a - Adapter: Digest Delivery | `run_timestamp, digest_text, anomaly_count, source_down_count, metrics_json` |
| `core_error_log` | shared `[CORE] Error Handler` | `workflowName, executionId, nodeName, errorMessage, timestamp` (shared schema, portfolio-wide) |

## Swap table (demo -> production)

| Concern | Demo implementation | Production swap |
|---|---|---|
| Digest delivery | `Deliver: Data Table` node in 05a inserts into `kpi_digests` | Replace with a Slack `postMessage` node or a Send Email node - the input shape (`run_timestamp, digest_text, anomaly_count, source_down_count, metrics_json`) is unchanged |
| Metric sources | 3 free, unauthenticated public APIs (GitHub, CoinGecko, Open-Meteo) | Swap the 3 HTTP Request nodes for whatever internal dashboards/APIs matter (Stripe MRR, product analytics, infra health) - `Aggregate Metrics` onward needs no changes |
| LLM | OpenRouter -> `anthropic/claude-haiku-4.5` | Swap the model string in `OpenRouter Chat Model`, or swap the credential/node entirely - `Basic LLM Chain` interface is unchanged |
| Anomaly threshold | Single constant `THRESHOLD_PCT = 15` in `Detect Anomalies` | Make per-metric if needed; the code node is the only place to touch |

## Execution evidence

All executions below are real, live runs against `http://localhost:5678`, workflow id
`4WQEI8UtzwcqRmgE` (`05 - KPI Watchdog`), captured in this session. `Get /api/v1/executions?workflowId=4WQEI8UtzwcqRmgE`
is the source of truth; ids below are directly queryable there.

| Execution ID | Scenario | Result | Notes |
|---|---|---|---|
| 18 | Normal run (baseline) | success | First clean run after the Merge-node fix; all 3 metrics live |
| 20 | Normal run A | success | github_stars 199,101, btc_price_usd 63,059, boston_temp_c 22.9 - 0 anomalies |
| 22 | Normal run B | success | Rolling history now 3 runs deep; 0 anomalies |
| 24 | **Injected anomaly** | success | `testOverrides.overrides.github_stars = 999999` -> pct_change +402.3% vs rolling mean -> `anomaly: true`; digest explicitly calls it out and rates system health "needs attention" |
| 26 | **Source-down simulation** | success | `testOverrides.forceSourceDown = "coingecko"` -> CoinGecko call 404s -> `ok: false`, real error message captured -> digest explicitly notes the gap ("Bitcoin pricing data is currently unavailable due to a source error... This should be resolved in the next run") -> run still completes and responds 200 |
| 29 | **Forced failure** | error (by design) | `testOverrides.forceCrash = true` throws inside `Throw Forced Failure` -> execution fails -> `settings.errorWorkflow` fires the shared `[CORE] Error Handler` (its execution **30**), which inserted row **id 2** into `core_error_log` with `workflowName: "05 - KPI Watchdog"`, `nodeName: "Throw Forced Failure"`, `executionId: "29"` |
| 164 | **Forced failure (re-verified)** | error (by design) | Same test, re-run after the team's `[CORE] Error Handler` race was resolved (canonical id `GC3Q52TUB5QgXhAq`) -> triggered CORE execution **165** -> inserted row **id 23** into `core_error_log`, `executionId: "164"` |
| 204 | **Real production failure (unplanned)** | error | Genuine live failure, not a test: OpenRouter returned 402 on the `Generate Digest` node - the LLM chain's `maxTokens` defaulted to `-1` (unbounded) and requested up to 64,000 tokens against the shared team credential's remaining balance. Correctly routed to `[CORE] Error Handler` (execution 205, `core_error_log` row id 25). Fixed by capping `maxTokens: 600` on `OpenRouter Chat Model` (a ~150-180 word digest needs a fraction of that) - also reduces load on the shared credential for other builders |
| 208 (parent) / 209 (05a) | **05a forced failure, independent of parent** | 05a: error (by design); 05 (parent): **success** | `testOverrides.forceCrash05a = true` -> 05a's own `Throw Forced Failure (05a)` throws -> 05a execution 209 fails and reaches `[CORE] Error Handler` on its own (execution **210**, `core_error_log` row **id 26**, `workflowName: "05a - Adapter: Digest Delivery"`, `parentExecutionId: "208"`) -> meanwhile parent execution **208** still completes successfully (`onError: continueRegularOutput` on the Execute Workflow node) and returns the full digest over the webhook, HTTP 200 |

`settings.errorWorkflow` is set on **both** `05 - KPI Watchdog` and `05a - Adapter:
Digest Delivery`, pointing at the canonical, portfolio-shared `[CORE] Error Handler`
(id `GC3Q52TUB5QgXhAq`), which writes to the canonical `core_error_log` Data Table (id
`CCpI8pLBFn1iyMPg`). An earlier duplicate `[CORE] Error Handler` this workflow briefly
created (id `6s4Ldj0Gpfe20qQJ`) was never executed even once before the team's
race-resolution deleted it, so no orphan `core_error_log` table was ever created from
that duplicate.

Adapter sub-workflow `05a - Adapter: Digest Delivery` (id `V7x8anftdJOYTgMJ`) executed
successfully on every normal/anomaly/source-down run above (mode `integrated`), each
time inserting a row into `kpi_digests` - and, per execution 209 above, fails
independently and audibly when asked to.

### Sample digest excerpt (execution 24, injected anomaly)

> Portfolio automation digest for 2026-08-03 03:10:54 UTC, triggered via webhook.
> GitHub stars surged to 999,999, representing a 402.3% jump against the four-run
> rolling average. This is flagged as an anomaly exceeding our 15% variance threshold
> and warrants investigation - such dramatic spikes typically indicate either a viral
> event, data quality issue, or measurement error that could skew downstream automation
> decisions.
>
> Bitcoin price held steady at $63,059 with no meaningful movement versus baseline.
> Boston temperature remained stable at 22.9°C.
>
> All three monitored metrics returned valid data this cycle. The GitHub stars anomaly
> is the sole outlier; if this reflects genuine community activity, it may trigger
> cascading effects across portfolio weighting or alert thresholds. If it's a data
> aberration, recalibration is needed before the next run.
>
> System health: needs attention pending GitHub stars root-cause analysis.

### Source-down digest excerpt (execution 26)

> ...Bitcoin pricing data is currently unavailable due to a source error (undefined
> property 'usd'), creating a gap in our cryptocurrency exposure monitoring. This should
> be resolved in the next run to maintain full portfolio visibility.
>
> System health requires attention due to the GitHub stars anomaly and the BTC data
> gap. Recommend immediate verification of data sources and investigation into the
> stars metric before drawing portfolio conclusions.

## Screenshots

- `img/05-kpi-watchdog-canvas.png` - full canvas, editor view, sticky-note documentation visible
- `img/05-kpi-watchdog-executions-list.png` - execution history sidebar showing the real run mix (success + the two intentional error tests)
- `img/05-kpi-watchdog-execution-success.png` - execution 24 (injected anomaly) rendered with the executed path highlighted green
- `img/05-kpi-watchdog-digest-content.png` - `Prepare Digest Record` node open, showing the real LLM digest text and the row it produces for `kpi_digests`

## Known limitations / not exercised in this session

- The daily **Schedule Trigger** path was not fired by the actual cron clock during this
  build (waiting a full day is impractical for a demo build session). It shares 100% of
  its downstream nodes with the webhook path (both feed `Init Context` identically), so
  the logic is proven, but a genuine clock-fired execution is unverified.
- The Slack/Email delivery swap described above is a documented pattern, not a wired
  integration - swapping the `Deliver: Data Table` node in 05a for a real Slack/Email
  node was intentionally left as the production step, per the adapter pattern.
