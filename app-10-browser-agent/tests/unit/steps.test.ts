import { describe, expect, it } from 'vitest'
import { MAX_STEPS, StepError, validateSteps } from '../../netlify/shared/steps'

const DEFAULTS = ['google.com', 'www.google.com', 'flights.google.com']
const LIST = 'google.com, www.google.com, flights.google.com'

/** Returns the rejection message for a plan, or "accepted" when the plan passes. */
function outcome(raw: unknown): string {
  try {
    validateSteps(raw, DEFAULTS)
  } catch (error) {
    expect(error).toBeInstanceOf(StepError)
    return error instanceof Error ? error.message : 'not an error'
  }
  return 'accepted'
}

describe('validateSteps', () => {
  it('keeps a valid plan and normalises its navigate address', () => {
    const steps = validateSteps([
      { action: 'navigate', target: 'Google home page', thought: 'Open the home page.', url: 'https://www.google.com/' },
      { action: 'type', target: 'search input', thought: 'Type the query.', value: 'Browserbase' },
      { action: 'extract', target: 'page title', thought: 'Read the title.', value: 'The page title' },
    ], DEFAULTS)
    expect(steps).toEqual([
      { action: 'navigate', target: 'Google home page', thought: 'Open the home page.', url: 'https://www.google.com/' },
      { action: 'type', target: 'search input', thought: 'Type the query.', value: 'Browserbase' },
      { action: 'extract', target: 'page title', thought: 'Read the title.', value: 'The page title' },
    ])
  })

  it('removes credentials from a navigate address', () => {
    const [step] = validateSteps([
      { action: 'navigate', target: 'Results', thought: 'Open results.', url: 'https://user:secret@www.google.com/search?q=x' },
    ], DEFAULTS)
    expect(step.url).toBe('https://www.google.com/search?q=x')
  })

  it('reads a bare host in the target as the address when no url is given', () => {
    const [step] = validateSteps([{ action: 'navigate', target: 'google.com', thought: 'Open it.' }], DEFAULTS)
    expect(step.url).toBe('https://google.com/')
  })

  it('drops the url from steps that are not navigate steps', () => {
    const [step] = validateSteps([
      { action: 'extract', target: 'page title', thought: 'Read it.', value: 'The title', url: 'https://www.google.com/' },
    ], DEFAULTS)
    expect(step).not.toHaveProperty('url')
    expect(step.value).toBe('The title')
  })

  it('accepts up to MAX_STEPS steps and rejects one more', () => {
    expect(MAX_STEPS).toBe(10)
    const step = { action: 'extract', target: 'page title', thought: 'Read it.' }
    expect(validateSteps(Array.from({ length: 10 }, () => step), DEFAULTS)).toHaveLength(10)
    expect(outcome(Array.from({ length: 11 }, () => step))).toBe('A plan needs 1 to 10 steps.')
  })

  it('rejects a plan that is not a non-empty array', () => {
    expect(outcome({ steps: [] })).toBe('A plan needs 1 to 10 steps.')
    expect(outcome([])).toBe('A plan needs 1 to 10 steps.')
    expect(outcome(null)).toBe('A plan needs 1 to 10 steps.')
  })

  it('rejects an action outside the enum, naming the step', () => {
    expect(outcome([
      { action: 'extract', target: 'page title', thought: 'Read it.' },
      { action: 'download', target: 'file', thought: 'Save it.' },
    ])).toBe('Step 2 has an action the browser does not support.')
  })

  it('rejects a step that is not an object', () => {
    expect(outcome([null])).toBe('Step 1 has an action the browser does not support.')
    expect(outcome(['navigate'])).toBe('Step 1 has an action the browser does not support.')
  })

  it('rejects a missing or blank target', () => {
    expect(outcome([{ action: 'extract', thought: 'Read it.' }])).toBe('Step 1 has no target.')
    expect(outcome([{ action: 'extract', target: '   ', thought: 'Read it.' }])).toBe('Step 1 has no target.')
  })

  it('rejects fields that are the wrong type or too long', () => {
    expect(outcome([{ action: 'extract', target: 'page title', thought: 42 }])).toBe('Step 1 has a thought that is not text.')
    expect(outcome([{ action: 'extract', target: 'x'.repeat(201), thought: 'Read it.' }]))
      .toBe('Step 1 has a target longer than 200 characters.')
    expect(outcome([{ action: 'extract', target: 'page title', thought: 'Read it.', value: 'v'.repeat(501) }]))
      .toBe('Step 1 has a value longer than 500 characters.')
    expect(outcome([{ action: 'navigate', target: 'Results', thought: 'Open.', url: 7 }]))
      .toBe('Step 1 has a url that is not text.')
    expect(outcome([{ action: 'navigate', target: 'Results', thought: 'Open.', url: `https://www.google.com/${'a'.repeat(2100)}` }]))
      .toBe('Step 1 has a url longer than 2048 characters.')
  })

  it('rejects an address that is not a web URL', () => {
    expect(outcome([{ action: 'navigate', target: 'Results', thought: 'Open.', url: 'javascript:alert(1)' }]))
      .toBe('Step 1 has an address that is not a valid URL.')
    expect(outcome([{ action: 'navigate', target: 'Google home page', thought: 'Open.' }]))
      .toBe('Step 1 has an address that is not a valid URL.')
  })

  it('refuses every address outside the allowlist, subdomain tricks and private hosts included', () => {
    expect(outcome([{ action: 'navigate', target: 'Example', thought: 'Open.', url: 'https://example.com/' }]))
      .toBe(`Step 1 opens example.com, which is outside the allowed sites: ${LIST}.`)
    expect(outcome([{ action: 'navigate', target: 'Lookalike', thought: 'Open.', url: 'https://google.com.evil.example/' }]))
      .toBe(`Step 1 opens google.com.evil.example, which is outside the allowed sites: ${LIST}.`)
    expect(outcome([{ action: 'navigate', target: 'Local', thought: 'Open.', url: 'http://127.0.0.1:8080/' }]))
      .toBe(`Step 1 opens 127.0.0.1, which is outside the allowed sites: ${LIST}.`)
  })

  it('names the first refused step when several are wrong', () => {
    expect(outcome([
      { action: 'navigate', target: 'Results', thought: 'Open.', url: 'https://www.google.com/' },
      { action: 'navigate', target: 'Other', thought: 'Open.', url: 'https://example.org/' },
      { action: 'navigate', target: 'Third', thought: 'Open.', url: 'https://example.net/' },
    ])).toBe(`Step 2 opens example.org, which is outside the allowed sites: ${LIST}.`)
  })

  it('accepts a plan that every check passes', () => {
    expect(outcome([{ action: 'navigate', target: 'Flights', thought: 'Open.', url: 'https://flights.google.com/' }]))
      .toBe('accepted')
  })
})
