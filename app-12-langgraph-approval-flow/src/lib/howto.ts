export const HOWTO_WHAT = 'Triage a live GitHub issue: find duplicates, draft labels and a reply, then wait for you.'

/** Each quoted label is the exact text of a control on the page; a test reads the components to keep them equal. */
export const HOWTO_STEPS: readonly string[] = [
  'Pick a repo under "Well-known repos", or type one under "Any repo or one issue".',
  'Choose an issue under "Issue", then press the "Triage" button. It takes a few seconds.',
  'The run stops at an approval card. Press "Approve", "Edit labels and priority" or "Reject".',
  'Nothing is posted to GitHub. Every reply is a draft.',
]

/**
 * The issue "Try it" loads, live from GitHub: an open microsoft/vscode report about the new look. The repo is busy
 * and the issue has earlier reports of the same complaint, so the duplicate check has real candidates to judge.
 * If it is ever deleted, the page shows GitHub's error and the "Try again" path of any failed load.
 */
export const TRY_IT_ISSUE = 'microsoft/vscode#325240'

export const HOWTO_HINT = 'Loads microsoft/vscode#325240 from GitHub and triages it. Stops at the approval card.'
