import type Browserbase from '@browserbasehq/sdk'
import { chromium, type Browser } from 'playwright-core'
import { withTimeout } from './browser'

/** Longest a connection, a page open or a browser close may take. */
export const BROWSER_TIMEOUT_MS = 7_000

/**
 * Connects over CDP under the time limit. A connection that arrives after the limit is closed as
 * soon as it resolves, so it cannot stay open with nothing using it.
 */
export async function connectBrowser(connectUrl: string): Promise<Browser> {
  let abandoned = false
  const connecting = chromium.connectOverCDP(connectUrl)
  void connecting.then(
    (late) => {
      if (abandoned) void late.close().catch(() => undefined)
    },
    () => undefined,
  )
  try {
    return await withTimeout(connecting, BROWSER_TIMEOUT_MS, 'The browser did not connect in time.')
  } catch (error) {
    abandoned = true
    throw error
  }
}

/**
 * Releases a session so Browserbase stops billing it. A release is not a billable create, so one
 * retry is safe. Returns false when both attempts fail. The session id is logged here and nowhere else.
 */
export async function releaseSession(client: Browserbase, sessionId: string, projectId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await client.sessions.update(sessionId, { status: 'REQUEST_RELEASE', projectId })
      return true
    } catch {
      // The first failure is retried. The second is logged below.
    }
  }
  console.error(`Browserbase session ${sessionId} could not be released`)
  return false
}
