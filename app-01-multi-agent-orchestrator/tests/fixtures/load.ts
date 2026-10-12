import { readFileSync } from 'node:fs'

/** Reads a file saved from an acceptance run, as text. */
export const fixture = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8')
