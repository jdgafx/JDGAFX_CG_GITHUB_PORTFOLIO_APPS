import { describe, expect, it } from 'vitest'
import { CONTENT_TYPES as clientContentTypes, STAGE_IDS as clientStageIds, STAGE_LABELS as clientLabels } from '../../src/lib/api'
import { CONTENT_TYPES, STAGE_IDS, STAGE_LABELS } from '../../netlify/shared/stages'

// The browser and the function each keep their own copy of these lists. This keeps them equal.
describe('browser and server agree', () => {
  it('list the same stages, in the same order, with the same labels', () => {
    expect(clientStageIds).toEqual(STAGE_IDS)
    expect(clientLabels).toEqual(STAGE_LABELS)
  })

  it('list the same content types', () => {
    expect(clientContentTypes).toEqual(CONTENT_TYPES)
  })
})
