/** Input bounds shared by the browser counter and the server check. */
export const MIN_CHARS = 200
export const MAX_CHARS = 20000
/** The Wikipedia loader trims to this, so a loaded article makes about 8 or 9 chunks and a run fits the platform's time limit. Pasted text may be up to MAX_CHARS. */
export const LOADER_MAX_CHARS = 10000

export const RANGE_MESSAGE = 'Paste between 200 and 20,000 characters.'
export const EMPTY_MESSAGE = 'Paste some text to analyze.'
