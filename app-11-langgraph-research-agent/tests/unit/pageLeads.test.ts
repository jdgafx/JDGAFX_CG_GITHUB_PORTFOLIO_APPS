import { describe, expect, it } from 'vitest'
import { readLead, summaryUrl } from '../../src/lib/pageLeads'
import { TRY_IT, TRY_IT_PAGES } from '../../src/lib/howto'

const page = {
  type: 'standard',
  title: 'Eiffel Tower',
  description: 'Tower in Paris, France',
  extract: 'The Eiffel Tower is a wrought-iron lattice tower on the Champ de Mars in Paris.',
  content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Eiffel_Tower' } },
}

describe('page leads from Wikipedia', () => {
  it('builds the page-summary address with the title as a path part', () => {
    expect(summaryUrl('Empire State Building')).toBe('https://en.wikipedia.org/api/rest_v1/page/summary/Empire_State_Building')
  })

  it('reads an ordinary page', () => {
    expect(readLead(page)).toEqual({ title: 'Eiffel Tower', description: 'Tower in Paris, France', extract: page.extract, url: 'https://en.wikipedia.org/wiki/Eiffel_Tower' })
  })

  it('refuses a disambiguation page, an empty extract, a link off en.wikipedia.org and anything that is not an object', () => {
    expect(readLead({ ...page, type: 'disambiguation' })).toBeNull()
    expect(readLead({ ...page, extract: '  ' })).toBeNull()
    expect(readLead({ ...page, content_urls: { desktop: { page: 'https://example.com/wiki/Eiffel_Tower' } } })).toBeNull()
    expect(readLead({ ...page, content_urls: undefined })).toBeNull()
    expect(readLead(null)).toBeNull()
    expect(readLead('x')).toBeNull()
  })

  it('shows the pages the Try it question names', () => {
    for (const title of TRY_IT_PAGES) expect(TRY_IT.question).toContain(title)
  })
})
