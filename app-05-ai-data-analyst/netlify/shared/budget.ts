// Time budgets that the server and the browser both read, so the browser's limit cannot drift away from
// the server's. The browser limit is the server's worst case plus CLIENT_GRACE_MS, which leaves the server
// room to answer with its own clear error (and what the run spent) before the browser gives up.
// tests/unit/budget.test.ts pins this.

/** The whole /api/ai run: the first call, its retry and the repair turn share it. Netlify cuts a synchronous invocation at about 30 s. */
export const RUN_BUDGET_MS = 25_000
/** Network time and a cold start, on top of the server's worst case. */
export const CLIENT_GRACE_MS = 5_000
