import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CommonsError,
  buildSearchUrl,
  fetchCommonsFile,
  downloadUrls,
  gridThumbUrl,
  thumbUrlAt,
  isTrustedImageUrl,
  parseSearchResponse,
  searchCommons,
  stripHtml,
  type CommonsImage,
} from '../../src/lib/commons'

afterEach(() => {
  vi.unstubAllGlobals()
})

const SCALED = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f5/Street_scene.jpg/1280px-Street_scene.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail'
const UNSCALED = 'https://upload.wikimedia.org/wikipedia/commons/d/df/Chart.png?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled'

// The shape of a real generator=search&prop=imageinfo reply (formatversion=2), cut to the fields the app reads.
// Pages arrive out of rank order, which is how the API sends them.
function page(index: number, title: string, info: Record<string, unknown>) {
  return { pageid: 1000 + index, ns: 6, title: `File:${title}`, index, imagerepository: 'local', imageinfo: [info] }
}

const FIXTURE = {
  batchcomplete: true,
  continue: { gsroffset: 12, continue: 'gsroffset||' },
  query: {
    pages: [
      page(3, 'Chart.png', {
        size: 5397,
        width: 320,
        height: 240,
        mime: 'image/png',
        thumburl: UNSCALED,
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Chart.png',
        extmetadata: {
          ObjectName: { value: 'Chart', source: 'mediawiki-metadata' },
          Artist: { value: 'Original uploader was <a href="https://uk.wikipedia.org/wiki/User:X">X&nbsp;Y</a> at uk.wikipedia' },
          LicenseShortName: { value: 'CC BY-SA 3.0' },
          LicenseUrl: { value: 'http://creativecommons.org/licenses/by-sa/3.0/' },
        },
      }),
      page(1, 'Street_scene.jpg', {
        size: 4560989,
        width: 2200,
        height: 3270,
        mime: 'image/jpeg',
        thumburl: SCALED,
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Street_scene.jpg',
        extmetadata: {
          ObjectName: { value: '<div class="fn">\n(Crowd in busy city street)</div>' },
          Artist: { value: '<bdi>Jane &amp; Co</bdi>' },
          LicenseShortName: { value: 'CC BY 4.0' },
          LicenseUrl: { value: 'javascript:alert(1)' },
        },
      }),
      page(2, 'Scan.tiff', {
        size: 16388382,
        width: 3072,
        height: 1778,
        mime: 'image/tiff',
        thumburl: SCALED,
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Scan.tiff',
        extmetadata: {},
      }),
      page(4, 'Huge_original.jpg', {
        size: 7612323,
        width: 1200,
        height: 900,
        mime: 'image/jpeg',
        thumburl: UNSCALED,
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Huge_original.jpg',
        extmetadata: {},
      }),
      page(5, 'Elsewhere.png', {
        size: 100,
        width: 100,
        height: 100,
        mime: 'image/png',
        thumburl: 'https://evil.example/Elsewhere.png',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Elsewhere.png',
        extmetadata: {},
      }),
      page(6, 'Bare_file.gif', {
        size: 900,
        width: 64,
        height: 64,
        mime: 'image/gif',
        thumburl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Bare_file.gif',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Bare_file.gif',
      }),
    ],
  },
}

describe('buildSearchUrl', () => {
  it('asks for file-namespace bitmap search results with a 1280 px thumbnail and only the metadata the app reads', () => {
    const url = new URL(buildSearchUrl('  road sign '))

    expect(url.origin + url.pathname).toBe('https://commons.wikimedia.org/w/api.php')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: 'query',
      format: 'json',
      formatversion: '2',
      origin: '*',
      generator: 'search',
      gsrnamespace: '6',
      gsrsearch: 'road sign filetype:bitmap',
      gsrlimit: '24',
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: '1280',
      iiextmetadatafilter: 'ObjectName|Artist|LicenseShortName|LicenseUrl',
    })
  })

  it('encodes search operators instead of passing them through as extra parameters', () => {
    const url = new URL(buildSearchUrl('a&gsrnamespace=0 #x'))
    expect(url.searchParams.get('gsrsearch')).toBe('a&gsrnamespace=0 #x filetype:bitmap')
    expect(url.searchParams.get('gsrnamespace')).toBe('6')
  })
})

describe('parseSearchResponse', () => {
  const images = parseSearchResponse(FIXTURE)

  it('keeps the usable results in rank order', () => {
    expect(images.map(image => image.fileName)).toEqual(['Street_scene.jpg', 'Chart.png', 'Bare_file.gif'])
  })

  it('drops other media types, an original over 4 MB and image addresses on other hosts', () => {
    const names = images.map(image => image.fileName)
    expect(names).not.toContain('Scan.tiff')
    expect(names).not.toContain('Huge_original.jpg')
    expect(names).not.toContain('Elsewhere.png')
  })

  it('keeps a scaled photo whose original is over 4 MB, because the thumbnail is what is sent', () => {
    expect(images[0]).toMatchObject({ mime: 'image/jpeg', width: 2200, height: 3270, thumbUrl: SCALED })
  })

  it('reads title, author and licence as plain text', () => {
    expect(images[0]).toMatchObject({
      title: '(Crowd in busy city street)',
      author: 'Jane & Co',
      licence: 'CC BY 4.0',
      pageUrl: 'https://commons.wikimedia.org/wiki/File:Street_scene.jpg',
    })
    expect(images[1]).toMatchObject({
      title: 'Chart',
      author: 'Original uploader was X Y at uk.wikipedia',
      licence: 'CC BY-SA 3.0',
      licenceUrl: 'http://creativecommons.org/licenses/by-sa/3.0/',
    })
  })

  it('only links a licence whose address is http or https', () => {
    expect(images[0].licenceUrl).toBeNull()
  })

  it('falls back to the file name and to stated gaps when metadata is missing', () => {
    expect(images[2]).toMatchObject({
      title: 'Bare file',
      author: 'Author not stated',
      licence: 'Licence not stated',
      licenceUrl: null,
    })
  })

  it('returns an empty list when the search matched nothing', () => {
    expect(parseSearchResponse({ batchcomplete: true })).toEqual([])
    expect(parseSearchResponse({ batchcomplete: true, query: { pages: [] } })).toEqual([])
  })

  it('throws a readable error for an API error or a body that is not an object', () => {
    expect(() => parseSearchResponse({ error: { code: 'badvalue', info: 'internal detail' } })).toThrow(
      'Wikimedia Commons could not run this search. Try other words.',
    )
    expect(() => parseSearchResponse('<html>')).toThrow(CommonsError)
  })
})

describe('stripHtml', () => {
  it('removes tags, decodes entities once and collapses whitespace', () => {
    expect(stripHtml('<p>A &amp;lt; B\n  <b>bold</b> &#169; &#x1F600; &nbsp;done</p>')).toBe('A &lt; B bold © 😀 done')
  })

  it('leaves an unknown entity as written and shortens long text with an ellipsis', () => {
    expect(stripHtml('x &madeup; y')).toBe('x &madeup; y')
    const long = stripHtml('word '.repeat(60))
    expect(long).toHaveLength(120)
    expect(long.endsWith('…')).toBe(true)
  })
})

const ORIGINAL = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Boats_in_Tenby_Harbour.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original'

describe('thumbUrlAt', () => {
  it('builds the standard thumbnail path from an original and drops the query', () => {
    expect(thumbUrlAt(ORIGINAL, 330)).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Boats_in_Tenby_Harbour.jpg/330px-Boats_in_Tenby_Harbour.jpg',
    )
  })

  it('changes the width of a scaled thumbnail and keeps its host', () => {
    expect(thumbUrlAt(SCALED, 330)).toBe(
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f5/Street_scene.jpg/330px-Street_scene.jpg',
    )
  })

  it('returns null for addresses it cannot rewrite and for names that are not JPEG, PNG, WebP or GIF', () => {
    expect(thumbUrlAt('https://upload.wikimedia.org/wikipedia/commons/a/ab/Scan.tiff', 330)).toBeNull()
    expect(thumbUrlAt('https://upload.wikimedia.org/wikipedia/en/a/ab/Name.jpg', 330)).toBeNull()
    expect(thumbUrlAt('not a url', 330)).toBeNull()
  })
})

describe('gridThumbUrl', () => {
  it('asks for a 330 px thumbnail, from a scaled thumbnail or from an original', () => {
    expect(gridThumbUrl(SCALED, 2200)).toBe(
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f5/Street_scene.jpg/330px-Street_scene.jpg',
    )
    expect(gridThumbUrl(ORIGINAL, 1024)).toContain('/thumb/a/ab/Boats_in_Tenby_Harbour.jpg/330px-')
  })

  it('uses the original only when the picture is no wider than a card', () => {
    expect(gridThumbUrl(UNSCALED, 320)).toBe(UNSCALED)
    expect(gridThumbUrl(ORIGINAL, 330)).toBe(ORIGINAL)
  })
})

describe('downloadUrls', () => {
  it('uses the 1280 px thumbnail the API sent for a wide picture', () => {
    expect(downloadUrls({ thumbUrl: SCALED, width: 2200 })).toEqual([SCALED])
  })

  it('tries the largest standard thumbnail no wider than the picture, then the original', () => {
    const urls = downloadUrls({ thumbUrl: ORIGINAL, width: 1024 })
    expect(urls[0]).toMatch(/\/960px-Boats_in_Tenby_Harbour\.jpg$/)
    expect(urls[1]).toBe(ORIGINAL)
    expect(downloadUrls({ thumbUrl: ORIGINAL, width: 640 })[0]).toMatch(/\/500px-/)
    expect(downloadUrls({ thumbUrl: ORIGINAL, width: 1280 })[0]).toMatch(/\/1280px-/)
  })

  it('goes straight to the original for a picture narrower than the smallest thumbnail', () => {
    expect(downloadUrls({ thumbUrl: ORIGINAL, width: 100 })).toEqual([ORIGINAL])
  })
})

describe('isTrustedImageUrl', () => {
  it('accepts https on the two Wikimedia image hosts only', () => {
    expect(isTrustedImageUrl(SCALED)).toBe(true)
    expect(isTrustedImageUrl(UNSCALED)).toBe(true)
    expect(isTrustedImageUrl('http://upload.wikimedia.org/a.png')).toBe(false)
    expect(isTrustedImageUrl('https://upload.wikimedia.org.evil.example/a.png')).toBe(false)
    expect(isTrustedImageUrl('not a url')).toBe(false)
  })
})

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(reply: (url: string, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn<Fetch>(reply)
  vi.stubGlobal('fetch', mock)
  return mock
}

const CARD: CommonsImage = parseSearchResponse(FIXTURE)[0]

describe('searchCommons', () => {
  it('requests the built URL and parses the reply', async () => {
    const mock = stubFetch(async () => Response.json(FIXTURE))

    const images = await searchCommons('busy street')

    expect(mock.mock.calls[0][0]).toBe(buildSearchUrl('busy street'))
    expect(images).toHaveLength(3)
  })

  it('shows at most 12 results, best match first', async () => {
    const pages = Array.from({ length: 20 }, (_, i) =>
      page(i + 1, `Photo_${i + 1}.jpg`, {
        size: 1000,
        width: 800,
        height: 600,
        mime: 'image/jpeg',
        thumburl: UNSCALED,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:Photo_${i + 1}.jpg`,
        extmetadata: {},
      }),
    )
    stubFetch(async () => Response.json({ query: { pages: pages.reverse() } }))

    const images = await searchCommons('photo')

    expect(images).toHaveLength(12)
    expect(images[0].fileName).toBe('Photo_1.jpg')
    expect(images[11].fileName).toBe('Photo_12.jpg')
  })

  it('maps HTTP 429, other HTTP errors, network failures and unreadable bodies to plain sentences', async () => {
    stubFetch(async () => new Response('', { status: 429 }))
    await expect(searchCommons('x')).rejects.toThrow('Wikimedia Commons is asking for fewer requests. Wait a moment and try again.')

    stubFetch(async () => new Response('', { status: 503 }))
    await expect(searchCommons('x')).rejects.toThrow('Wikimedia Commons answered with HTTP 503. Try again.')

    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })
    await expect(searchCommons('x')).rejects.toThrow('Could not reach Wikimedia Commons. Check your connection and try again.')

    stubFetch(async () => new Response('<html>', { status: 200 }))
    await expect(searchCommons('x')).rejects.toThrow('Wikimedia Commons sent a reply that could not be read.')
  })

  it('reports a timeout when the request never finishes', async () => {
    // AbortSignal.timeout runs on the runtime's own clock, which fake timers do not move, so the test fires it.
    const expiry = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(expiry.signal)
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    const outcome = searchCommons('x').catch((err: unknown) => err)
    expiry.abort(new DOMException('The operation timed out.', 'TimeoutError'))

    expect(await outcome).toMatchObject({ message: 'Wikimedia Commons did not answer in time. Try again.' })
    expect(timeout).toHaveBeenCalledWith(12_000)
    timeout.mockRestore()
  })

  it('rethrows the abort when the caller cancels', async () => {
    const controller = new AbortController()
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    const outcome = searchCommons('x', controller.signal).catch((err: unknown) => err)
    controller.abort()
    expect(await outcome).toMatchObject({ name: 'AbortError' })
  })
})

describe('fetchCommonsFile', () => {
  it('downloads the thumbnail as a File named after the Commons file, typed from the response', async () => {
    const mock = stubFetch(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } }))

    const file = await fetchCommonsFile(CARD)

    expect(mock.mock.calls[0][0]).toBe(SCALED)
    expect(file.name).toBe('Street_scene.jpg')
    expect(file.type).toBe('image/jpeg')
    expect(file.size).toBe(3)
  })

  it('applies the upload checks: a download that is not an accepted image type is refused', async () => {
    stubFetch(async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(fetchCommonsFile(CARD)).rejects.toThrow('Unsupported file type: text/html. Please use JPG, PNG, WebP, or GIF.')
  })

  it('applies the upload checks: a download over 4 MB is refused', async () => {
    stubFetch(async () => new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } }))
    await expect(fetchCommonsFile(CARD)).rejects.toThrow('Image is too large (4.0 MB). Maximum size is 4 MB.')
  })

  it('never fetches an address outside the Wikimedia image hosts', async () => {
    const mock = stubFetch(async () => new Response(''))
    await expect(fetchCommonsFile({ ...CARD, thumbUrl: 'https://evil.example/a.png' })).rejects.toThrow(
      'This image comes from an address that is not allowed.',
    )
    expect(mock).not.toHaveBeenCalled()
  })

  it('falls back to the original when the thumbnail request is refused, and tries the thumbnail first', async () => {
    const mock = stubFetch(async url =>
      String(url).includes('/thumb/')
        ? new Response('slow down', { status: 429 })
        : new Response(new Uint8Array([9]), { headers: { 'Content-Type': 'image/jpeg' } }),
    )

    const file = await fetchCommonsFile({ ...CARD, width: 1024, thumbUrl: ORIGINAL })

    expect(mock.mock.calls.map(call => String(call[0]).includes('/thumb/'))).toEqual([true, false])
    expect(file.size).toBe(1)
  })

  it('does not try the next address after a download that fails the file checks', async () => {
    const mock = stubFetch(async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(fetchCommonsFile({ ...CARD, width: 1024, thumbUrl: ORIGINAL })).rejects.toThrow('Unsupported file type')
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('reports the last failure when every address is refused', async () => {
    stubFetch(async () => new Response('', { status: 429 }))
    await expect(fetchCommonsFile({ ...CARD, width: 1024, thumbUrl: ORIGINAL })).rejects.toThrow('asking for fewer requests')
  })
})
