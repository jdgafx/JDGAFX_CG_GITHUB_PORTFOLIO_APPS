import { describe, expect, it } from 'vitest'
import { locationLabel, questionStarters, unitHeading } from '../../src/lib/location'

const TITLES = [
  'Photosynthesis',
  'Overview',
  'Light-dependent reactions',
  'Light-dependent reactions > Z scheme',
  'Light-independent reactions',
  'Efficiency',
  'Evolution',
  'Factors',
]

describe('locationLabel', () => {
  it('names a PDF location as a page', () => {
    expect(locationLabel({ unit: 'page', sectionTitles: [] }, 4)).toBe('page 4')
  })

  it('names an article location as a numbered section with its title', () => {
    expect(locationLabel({ unit: 'section', sectionTitles: TITLES }, 4)).toBe('section 4: Light-dependent reactions > Z scheme')
  })

  it('falls back to the bare number when a section has no recorded title', () => {
    expect(locationLabel({ unit: 'section', sectionTitles: [] }, 2)).toBe('section 2')
  })
})

describe('unitHeading', () => {
  it('labels the figure as Pages or Sections', () => {
    expect(unitHeading({ unit: 'page' })).toBe('Pages')
    expect(unitHeading({ unit: 'section' })).toBe('Sections')
  })
})

describe('questionStarters', () => {
  it('asks about the whole article, then about top-level sections spread across it', () => {
    expect(questionStarters(TITLES)).toEqual([
      'What is Photosynthesis?',
      'What does it say about Overview?',
      'What does it say about Light-independent reactions?',
      'What does it say about Evolution?',
    ])
  })

  it('uses the last part of a nested title when there are too few top-level sections', () => {
    expect(questionStarters(['Topic', 'History > Origins'])).toEqual(['What is Topic?', 'What does it say about Origins?'])
  })

  it('offers only the whole-article question for a one-section article, and none without titles', () => {
    expect(questionStarters(['Topic'])).toEqual(['What is Topic?'])
    expect(questionStarters([])).toEqual([])
  })
})
