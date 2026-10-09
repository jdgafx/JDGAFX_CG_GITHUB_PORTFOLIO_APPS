/**
 * Limits shared by the browser and the analysis function. Both sides read them from
 * here, so the browser only sends a sample the server accepts.
 */
export const MAX_ROWS = 20_000
export const MAX_QUESTION_CHARS = 2000
export const MAX_SAMPLE_ROWS = 5
export const MAX_HEADERS = 200
export const MAX_CELL_CHARS = 200
export const MAX_BODY_BYTES = 128 * 1024
