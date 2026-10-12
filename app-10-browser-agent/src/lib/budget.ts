// Every time limit the page and the functions must agree on. The functions use these numbers for their
// own limits and the page derives its waits from them, so the two sides cannot drift apart.

/** Added to a server worst case for the network and a cold start. */
export const CLIENT_MARGIN_MS = 3_000
/** The platform ends a planner request here. */
export const PLAN_PLATFORM_CUT_MS = 30_000
/** The platform ends a streamed run here. */
export const RUN_PLATFORM_CUT_MS = 60_000

/**
 * The planner's whole budget: the first call and any retry share it. The model list is read alongside the calls
 * and ends within its own 3 s, so the answer, or the clear error with the trace and usage, is out by this time.
 */
export const PLAN_BUDGET_MS = 24_000
/** How long the page waits for the planner: its budget plus the margin. */
export const PLAN_CLIENT_WAIT_MS = PLAN_BUDGET_MS + CLIENT_MARGIN_MS

// Limits inside one browser run, in the order the run meets them.
/** Chromium unpacks and starts. */
export const LAUNCH_MS = 10_000
/** The context and the page open together. */
export const OPEN_PAGE_MS = 4_000
/** No new step starts after this much time since the browser was ready. */
export const STEP_GATE_MS = 12_000
/** One page navigation. */
export const NAVIGATE_MS = 8_000
/** One page action or one count of matches. */
export const ACTION_MS = 3_000
/** A typed value read back. */
export const INPUT_READ_MS = 1_000
/** The page title. */
export const TITLE_MS = 2_000
/** A region read. */
export const REGION_MS = 2_000
/** The whole page text. */
export const BODY_TEXT_MS = 2_000
/** One page picture. */
export const CAPTURE_MS = 3_000
/** Letting go of the picture session. */
export const DETACH_MS = 1_000
/** The browser closes. */
export const CLOSE_MS = 4_000
/** The cleanup after the close: ending leftover processes, sweeping /tmp, reading the diagnostics. */
export const CLEANUP_MS = 2_000

/** One page read: the title is asked alongside, then a region and, when it is empty, the page text. */
export const SNAPSHOT_MS = Math.max(TITLE_MS, REGION_MS + BODY_TEXT_MS)
/** The slowest step action: a navigation, a find (count, then a page read), a click, or a type (count, fill, read back). */
export const STEP_ACTION_MS = Math.max(NAVIGATE_MS, ACTION_MS + SNAPSHOT_MS, 2 * ACTION_MS, 2 * ACTION_MS + INPUT_READ_MS)
/** A step that fails after its action: the action, the read that fails, the read for the failed row, and its picture. */
export const FAILED_STEP_MS = STEP_ACTION_MS + 2 * SNAPSHOT_MS + CAPTURE_MS
/** A step that works, then the last page read that ends the run. */
export const LAST_STEP_AND_READ_MS = STEP_ACTION_MS + SNAPSHOT_MS + CAPTURE_MS + SNAPSHOT_MS
/** A step that works, then the next step meets the end of the window: the page read and the picture for the failed row. */
export const STEP_THEN_GATE_MS = STEP_ACTION_MS + SNAPSHOT_MS + CAPTURE_MS + SNAPSHOT_MS + CAPTURE_MS
/** The time from the last step starting inside the window to the run being over, before the close. */
export const LAST_STEP_TAIL_MS = Math.max(FAILED_STEP_MS, LAST_STEP_AND_READ_MS, STEP_THEN_GATE_MS)
/** The close row: the picture session, the browser and the cleanup. */
export const CLOSE_ROW_MS = DETACH_MS + CLOSE_MS + CLEANUP_MS

/** The longest a run takes on the server: the start, the step window, the last step that began inside it, and the close. */
export const RUN_WORST_MS = LAUNCH_MS + OPEN_PAGE_MS + STEP_GATE_MS + LAST_STEP_TAIL_MS + CLOSE_ROW_MS
/** The longest quiet stretch between two events of a run. */
export const RUN_MAX_GAP_MS = Math.max(LAUNCH_MS, OPEN_PAGE_MS, LAST_STEP_TAIL_MS, CLOSE_ROW_MS)
/** How long the page waits for a whole run: the server's worst case plus the margin. It stays under the platform cut. */
export const RUN_CLIENT_WAIT_MS = RUN_WORST_MS + CLIENT_MARGIN_MS
