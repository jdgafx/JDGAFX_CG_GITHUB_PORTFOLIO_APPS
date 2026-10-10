import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Notices, { type Failure } from '../../src/components/Notices'
import { NpmError } from '../../src/lib/npm'

const base = { allFailed: false, span: null, loading: false, releaseFailures: [], onRetry: () => undefined, onRetryReleases: () => undefined, onRemove: () => undefined }
const html = (props: { failures: Failure[]; releaseFailures?: { name: string; message: string }[] }) => renderToStaticMarkup(createElement(Notices, { ...base, ...props }))

describe('the buttons that retry a failed read say Try again', () => {
  it('labels a failed package read "Try again", never "Retry"', () => {
    const out = html({ failures: [{ name: 'vite', error: new NpmError('network', 'Could not reach npm. Check your connection, then try again.') }] })
    expect(out).toContain('>Try again</button>')
    expect(out).not.toMatch(/>Retry/) // the button text only: the error sentences say "try again" too
  })

  it('labels a failed release history read "Try again", never "Retry"', () => {
    const out = html({ failures: [], releaseFailures: [{ name: 'vite', message: 'The npm registry sent a reply this page could not read.' }] })
    expect(out).toContain('>Try again</button>')
    expect(out).not.toMatch(/>Retry/) // the button text only: the error sentences say "try again" too
  })
})
