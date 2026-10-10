import { describe, expect, it } from 'vitest'
import { priceCall } from '../../netlify/shared/cost'
import { recordedPrices, SERVED_MODEL } from '../helpers/prices'

const usage = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 }

describe('priceCall with the served model on the list', () => {
  it('prices 1000 prompt and 200 completion tokens at the listed $0.0000001 and $0.0000005 per token, which is 0.0002 USD', () => {
    expect(priceCall(recordedPrices(), SERVED_MODEL, usage)).toEqual({
      priceState: 'priced',
      cost: 0.0002,
      rate: { prompt: 0.0000001, completion: 0.0000005 },
    })
  })

  it('prices a million tokens each way at the listed price, 0.10 plus 0.50', () => {
    const million = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 }

    expect(priceCall(recordedPrices(), SERVED_MODEL, million).cost).toBeCloseTo(0.6, 9)
  })

  it('prices the served model, not the model that was asked for: a different served id gets its own price', () => {
    const served = priceCall(recordedPrices(), 'anthropic/claude-haiku-4.5', usage)

    expect(served.cost).toBe(0.002)
    expect(served.rate).toEqual({ prompt: 0.000001, completion: 0.000005 })
  })

  it('prices a free model at zero, which is a real price', () => {
    expect(priceCall(recordedPrices(), 'apodex/apodex-1.1-mini:free', usage)).toMatchObject({ priceState: 'priced', cost: 0 })
  })
})

describe('priceCall without a price', () => {
  it('gives no price and says why when the reply carried no model field', () => {
    expect(priceCall(recordedPrices(), null, usage)).toEqual({ priceState: 'no-served-model' })
    expect(priceCall(recordedPrices(), '', usage)).toEqual({ priceState: 'no-served-model' })
  })

  it('says the model field is missing even when the list also failed, since the model is the first thing needed', () => {
    expect(priceCall(null, null, usage)).toEqual({ priceState: 'no-served-model' })
  })

  it('gives no price and no fallback when the list could not be fetched', () => {
    expect(priceCall(null, SERVED_MODEL, usage)).toEqual({ priceState: 'unavailable' })
  })

  it('gives no price when the list does not carry the served model', () => {
    expect(priceCall(recordedPrices(), 'someone/unlisted-model', usage)).toEqual({ priceState: 'unavailable' })
  })

  it('gives no price when the token counts are incomplete, and never counts a missing count as zero', () => {
    expect(priceCall(recordedPrices(), SERVED_MODEL, { total_tokens: 1200 })).toEqual({ priceState: 'unavailable' })
    expect(priceCall(recordedPrices(), SERVED_MODEL, { prompt_tokens: 1000 })).toEqual({ priceState: 'unavailable' })
    expect(priceCall(recordedPrices(), SERVED_MODEL, null)).toEqual({ priceState: 'unavailable' })
  })
})
