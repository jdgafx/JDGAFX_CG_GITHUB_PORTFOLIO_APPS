/** Shared between the browser bundle and the Netlify function — single source of truth. */
export const MAX_CODE_LENGTH = 50000

export const OVER_LIMIT_MESSAGE = `Code exceeds the ${MAX_CODE_LENGTH.toLocaleString('en-US')} character limit`
