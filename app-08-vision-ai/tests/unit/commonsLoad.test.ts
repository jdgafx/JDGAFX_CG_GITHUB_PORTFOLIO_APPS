import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', async () => (await import('../helpers/hooks')).reactStub)

import CommonsPicker from '../../src/components/CommonsPicker'
import { TRY_PRESET } from '../../src/lib/howto'
import { render, resetHooks, unmount } from '../helpers/hooks'

const settle = () => new Promise(resolve => setTimeout(resolve, 5))

// A Commons search answer with two usable pictures.
function commonsReply() {
  const page = (index: number, name: string) => ({
    title: `File:${name}`,
    index,
    imageinfo: [
      {
        mime: 'image/jpeg',
        width: 1280,
        height: 853,
        size: 100_000,
        thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/${name}/1280px-${name}`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}`,
        extmetadata: { Artist: { value: 'A. Photographer' }, LicenseShortName: { value: 'CC BY 4.0' } },
      },
    ],
  })
  return new Response(JSON.stringify({ query: { pages: [page(1, 'One.jpg'), page(2, 'Two.jpg')] } }), { status: 200 })
}

beforeEach(() => resetHooks())
afterEach(() => {
  unmount()
  vi.unstubAllGlobals()
})

type Props = Parameters<typeof CommonsPicker>[0]
const props = (over: Partial<Props> = {}): Props => ({
  disabled: false,
  slotsLeft: 1,
  loaded: '',
  label: '',
  onPick: vi.fn(),
  onFailure: vi.fn(),
  ...over,
})

describe('the Commons picker on load', () => {
  it('lists live Commons pictures before the visitor asks, and reports how many and when', async () => {
    const fetchStub = vi.fn(async () => commonsReply())
    vi.stubGlobal('fetch', fetchStub)
    const onListed = vi.fn()
    const onAutoSearched = vi.fn()
    const picker = () => render(() => CommonsPicker(props({ autoQuery: TRY_PRESET.query, onListed, onAutoSearched })))
    picker()
    await settle()
    picker()
    expect(fetchStub).toHaveBeenCalledTimes(1)
    const url = String((fetchStub.mock.calls[0] as unknown[])[0])
    expect(url).toContain('commons.wikimedia.org/w/api.php')
    expect(decodeURIComponent(url.replace(/\+/g, ' '))).toContain(TRY_PRESET.query)
    expect(onAutoSearched).toHaveBeenCalledTimes(1)
    expect(onListed).toHaveBeenCalledTimes(1)
    expect(onListed.mock.calls[0][0]).toMatchObject({ count: 2 })
    expect(Math.abs(onListed.mock.calls[0][0].at - Date.now())).toBeLessThan(5_000)
  })

  it('searches nothing without an autoQuery, and a failed search is reported as a failure, not as a listing', async () => {
    const fetchStub = vi.fn(async () => commonsReply())
    vi.stubGlobal('fetch', fetchStub)
    render(() => CommonsPicker(props({ onListed: vi.fn() })))
    await settle()
    expect(fetchStub).not.toHaveBeenCalled()

    resetHooks()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    const onListed = vi.fn()
    const failing = props({ autoQuery: TRY_PRESET.query, onListed, onAutoSearched: vi.fn() })
    const picker = () => render(() => CommonsPicker(failing))
    picker()
    await settle()
    picker()
    expect(onListed).not.toHaveBeenCalled()
    expect(failing.onFailure).toHaveBeenLastCalledWith(true)
  })
})
