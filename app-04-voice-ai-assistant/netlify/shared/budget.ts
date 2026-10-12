// Time budgets that the server and the browser both read, so the browser's limits cannot drift away from
// the server's. A browser limit is the server's worst case for the request plus CLIENT_GRACE_MS, which
// leaves the server room to answer with its own clear error (and the usage spent so far) before the
// browser gives up. tests/unit/budget.test.ts pins this.

/** The whole /api/ai run, retry included. Netlify cuts a synchronous invocation at about 30 s. */
export const RUN_BUDGET_MS = 25_000
/** The Deepgram request behind /api/transcribe, response body included. */
export const TRANSCRIBE_BUDGET_MS = 25_000
/** How often /api/ai sends a comment line while the model thinks. */
export const PING_MS = 10_000
/** Network time and a cold start, on top of the server's worst case. */
export const CLIENT_GRACE_MS = 5_000
