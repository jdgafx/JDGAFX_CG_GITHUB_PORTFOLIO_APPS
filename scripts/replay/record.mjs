#!/usr/bin/env node
// Records one real run of an app's built-in example as a visitor would start it, and writes <app>.json.
// Usage: node record.mjs --app app-06-llm-playground [--out dir]   (everything else comes from apps/<app>.json)
// Exits non-zero, writing nothing, if the run errored or did not finish.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { buildRecording, ConfigError, loadAppConfig } from './lib.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []))
const app = args.app
let config
try {
  config = loadAppConfig(app)
} catch (err) {
  if (!(err instanceof ConfigError)) throw err
  console.error(`${err.message}\nusage: node record.mjs --app <app-slug> [--out <dir>]`)
  process.exit(2)
}
const target = new URL(config.url)
const outDir = path.resolve(args.out ?? '.')
const RUN_TIMEOUT_MS = 120_000

// Runs in the page before any app code. It wraps fetch, so the app is untouched, and logs every same-origin call under apiPrefix
// with its request body, status, headers and each body chunk as it arrives. Times are performance.now(); t0 is the first click.
function installLogger(apiPrefix) {
  window.__replayLog = []
  window.__replayT0 = null
  document.addEventListener('click', () => (window.__replayT0 ??= performance.now()), true)
  const original = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href)
    if (url.origin !== location.origin || !url.pathname.startsWith(apiPrefix)) return original(input, init)
    const method = (init?.method ?? (typeof input === 'string' || input instanceof URL ? 'GET' : input.method)).toUpperCase()
    const entry = { method, path: url.pathname + url.search, request_body: typeof init?.body === 'string' ? init.body : null, t_start: performance.now(), chunks: [], done: false, error: null }
    window.__replayLog.push(entry)
    let res
    try {
      res = await original(input, init)
    } catch (err) {
      entry.error = String(err)
      throw err
    }
    entry.t_headers = performance.now()
    entry.status = res.status
    entry.headers = [...res.headers.entries()]
    const reader = res.clone().body.getReader()
    const decoder = new TextDecoder()
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          entry.chunks.push({ t: performance.now(), text: decoder.decode(value, { stream: true }) })
        }
        const tail = decoder.decode()
        if (tail) entry.chunks.push({ t: performance.now(), text: tail })
        entry.t_end = performance.now()
        entry.done = true
      } catch (err) {
        entry.error = String(err)
      }
    })()
    return res
  }
}

const browser = await chromium.launch({ headless: true })
let recording
try {
  const context = await browser.newContext({ userAgent: 'jdgafx-portfolio-bot/1.0', viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.addInitScript(installLogger, config.apiPrefix)
  // ?replay=off: the page must make a live run, never play a recording back, or the recording would record itself.
  await page.goto(`${target.origin}${target.pathname}?replay=off`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.getByRole('button', { name: config.tryButton, exact: true }).click({ timeout: 60_000 })
  await page.waitForFunction(
    finishPath => window.__replayLog.some(e => e.error || (e.done && e.path === finishPath) || (e.done && (e.status < 200 || e.status > 299))),
    config.finishPath,
    { timeout: RUN_TIMEOUT_MS },
  )
  if (config.settleMs) await page.waitForTimeout(config.settleMs)
  const { t0, exchanges } = await page.evaluate(() => ({ t0: window.__replayT0, exchanges: window.__replayLog }))
  recording = buildRecording({ app, config, url: target.href, recordedAt: new Date().toISOString(), t0, exchanges })
} catch (err) {
  console.error(`REFUSED to save a recording of ${app}: ${err instanceof Error ? err.message : err}`)
  process.exitCode = 1
} finally {
  await browser.close()
}

if (recording) {
  mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, `${app}.json`)
  const temp = `${file}.tmp`
  writeFileSync(temp, `${JSON.stringify(recording)}\n`)
  renameSync(temp, file)
  const last = recording.exchanges.reduce((m, e) => Math.max(m, e.t_end), 0)
  console.log(`recorded ${app}: ${recording.exchanges.length} exchanges, ${(last / 1000).toFixed(1)} s, judge ${recording.reported.model}, judge cost $${recording.reported.cost_usd.toFixed(6)} -> ${file}`)
}
