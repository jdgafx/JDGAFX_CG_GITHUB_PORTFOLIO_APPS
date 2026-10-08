import { describe, expect, it } from 'vitest'
import { firstJsonObject, readExtraction, readRationale } from '../../netlify/shared/nodes'

describe('firstJsonObject', () => {
  it('reads the object inside a code fence', () => {
    const reply = '```json\n{"orderId": "ORD-1042", "issue": "duplicate_charge", "requestedAmount": 129}\n```'
    expect(firstJsonObject(reply)).toEqual({ orderId: 'ORD-1042', issue: 'duplicate_charge', requestedAmount: 129 })
  })

  it('reads the first object when prose and other braces surround it', () => {
    const reply =
      'Facts {as requested}: {"orderId": "ORD-1077", "issue": "defective_item", "requestedAmount": null} Hope this helps {thanks}.'
    expect(firstJsonObject(reply)).toEqual({ orderId: 'ORD-1077', issue: 'defective_item', requestedAmount: null })
  })

  it('handles nested objects and braces inside strings', () => {
    const reply = '{"orderId": "ORD-1077", "note": "a } brace", "meta": {"source": "ticket"}, "issue": "defective_item"}'
    expect(firstJsonObject(reply)).toMatchObject({ note: 'a } brace', meta: { source: 'ticket' }, issue: 'defective_item' })
  })

  it('returns null when there is no complete object', () => {
    expect(firstJsonObject('no facts here, only {broken and [1, 2]')).toBeNull()
  })
})

describe('readExtraction', () => {
  it('reads the facts from a fenced reply', () => {
    expect(
      readExtraction('```json\n{"orderId": "ord-1042", "issue": "duplicate_charge", "requestedAmount": 129}\n```'),
    ).toEqual({ orderId: 'ORD-1042', issue: 'duplicate_charge', requestedAmount: 129 })
  })

  it('reads the facts from a reply with prose around the object', () => {
    expect(
      readExtraction('Sure. {"orderId": "ORD-1077", "issue": "defective_item", "requestedAmount": 24.5} Anything else?'),
    ).toEqual({ orderId: 'ORD-1077', issue: 'defective_item', requestedAmount: 24.5 })
  })

  it('returns null when no reply carries a known issue', () => {
    expect(readExtraction('{"orderId": "ORD-1042", "issue": "refund please"}')).toBeNull()
    expect(readExtraction('I cannot help with that.')).toBeNull()
  })

  it('drops an order id that is not in the ORD-1234 form', () => {
    expect(readExtraction('{"orderId": "1042", "issue": "other", "requestedAmount": null}')).toEqual({
      orderId: null,
      issue: 'other',
      requestedAmount: null,
    })
  })
})

describe('readRationale', () => {
  it('reads the rationale from a fenced reply', () => {
    expect(readRationale('```json\n{"rationale": "Two charges of $129.00 were found."}\n```')).toBe(
      'Two charges of $129.00 were found.',
    )
  })

  it('returns null for a blank or missing rationale', () => {
    expect(readRationale('{"rationale": "   "}')).toBeNull()
    expect(readRationale('no json')).toBeNull()
  })
})
