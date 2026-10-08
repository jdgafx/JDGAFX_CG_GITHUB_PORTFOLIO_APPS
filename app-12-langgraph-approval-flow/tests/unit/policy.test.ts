import { describe, expect, it } from 'vitest'
import { AUTO_APPROVE_LIMIT, RETURN_WINDOW_DAYS, evaluatePolicy, resolveDecision } from '../../netlify/shared/policy'
import { findOrder, sampleOrders, type Order } from '../../src/lib/orders'

const NOW = new Date('2026-10-08T12:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString()
const orders = sampleOrders(NOW)

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ORD-2000',
    customer: 'Test Customer',
    items: [{ sku: 'T-1', name: 'Test item', unitPrice: 20, quantity: 1 }],
    total: 20,
    charges: [20],
    orderedAt: daysAgo(10),
    deliveredAt: daysAgo(5),
    status: 'delivered',
    finalSale: false,
    ...overrides,
  }
}

describe('sample orders', () => {
  it('holds the five sample orders, with the duplicate charge and the small defect in place', () => {
    expect(orders.map((o) => o.id)).toEqual(['ORD-1042', 'ORD-1077', 'ORD-1031', 'ORD-0998', 'ORD-1055'])
    expect(findOrder(orders, 'ORD-1042')).toMatchObject({ total: 129, charges: [129, 129] })
    expect(findOrder(orders, 'ORD-1077')).toMatchObject({ total: 24.5, charges: [24.5] })
    expect(findOrder(orders, 'ORD-1055')?.finalSale).toBe(true)
  })

  it('counts the sample dates back from the given day', () => {
    const delivered = Date.parse(findOrder(orders, 'ORD-1042')?.deliveredAt ?? '')
    expect((NOW.getTime() - delivered) / DAY_MS).toBe(6)
  })

  it('finds no order for a null id', () => {
    expect(findOrder(orders, null)).toBeUndefined()
  })
})

describe('evaluatePolicy: the rules', () => {
  it('is unclear when the ticket names no order', () => {
    expect(evaluatePolicy({ orderId: null, issue: 'duplicate_charge' }, undefined, NOW)).toEqual({
      eligible: false,
      reason: 'The ticket does not name an order, so a person must check it.',
      amount: 0,
      requiresHuman: true,
    })
  })

  it('is unclear when the order id matches no order', () => {
    const result = evaluatePolicy({ orderId: 'ORD-9999', issue: 'defective_item' }, undefined, NOW)
    expect(result).toMatchObject({ eligible: false, amount: 0, requiresHuman: true })
    expect(result.reason).toBe('No order matches ORD-9999, so a person must check it.')
  })

  it('is unclear when the issue is neither a duplicate charge nor a defect', () => {
    const result = evaluatePolicy({ orderId: 'ORD-1077', issue: 'other' }, findOrder(orders, 'ORD-1077'), NOW)
    expect(result).toMatchObject({ eligible: false, amount: 0, requiresHuman: true })
  })

  it('denies an order delivered more than 30 days ago, and no person is needed', () => {
    const result = evaluatePolicy({ orderId: 'ORD-0998', issue: 'defective_item' }, findOrder(orders, 'ORD-0998'), NOW)
    expect(result).toEqual({
      eligible: false,
      reason: `Delivered 47 days ago. Refunds need a request within ${RETURN_WINDOW_DAYS} days of delivery.`,
      amount: 0,
      requiresHuman: false,
    })
  })

  it('denies a final sale item, and no person is needed', () => {
    const result = evaluatePolicy({ orderId: 'ORD-1055', issue: 'defective_item' }, findOrder(orders, 'ORD-1055'), NOW)
    expect(result).toEqual({
      eligible: false,
      reason: 'Final sale orders cannot be refunded.',
      amount: 0,
      requiresHuman: false,
    })
  })

  it('refunds the extra duplicate charge, and a person approves it because it is over $50', () => {
    const result = evaluatePolicy({ orderId: 'ORD-1042', issue: 'duplicate_charge' }, findOrder(orders, 'ORD-1042'), NOW)
    expect(result).toMatchObject({ eligible: true, amount: 129, requiresHuman: true })
    expect(result.reason).toContain('charged 2 times')
    expect(result.reason).toContain('$129.00 is over $50.00')
  })

  it('approves a small defective item automatically, at its price', () => {
    const result = evaluatePolicy({ orderId: 'ORD-1077', issue: 'defective_item' }, findOrder(orders, 'ORD-1077'), NOW)
    expect(result).toMatchObject({ eligible: true, amount: 24.5, requiresHuman: false })
    expect(result.reason).toContain('within the automatic limit of $50.00')
  })

  it('needs a person for a defective item above $50', () => {
    const result = evaluatePolicy({ orderId: 'ORD-1031', issue: 'defective_item' }, findOrder(orders, 'ORD-1031'), NOW)
    expect(result).toMatchObject({ eligible: true, amount: 389, requiresHuman: true })
  })

  it('is unclear when a duplicate claim shows no extra charge', () => {
    const result = evaluatePolicy({ orderId: 'ORD-1077', issue: 'duplicate_charge' }, findOrder(orders, 'ORD-1077'), NOW)
    expect(result).toEqual({
      eligible: false,
      reason: 'The order shows no extra charge, so a person must check the payment before any refund.',
      amount: 0,
      requiresHuman: true,
    })
  })

  it('is unclear when a defect claim has more than one item to choose from', () => {
    const twoItems = order({
      items: [
        { sku: 'A', name: 'Lamp', unitPrice: 10, quantity: 1 },
        { sku: 'B', name: 'Shade', unitPrice: 8, quantity: 1 },
      ],
      total: 18,
      charges: [18],
    })
    const result = evaluatePolicy({ orderId: twoItems.id, issue: 'defective_item' }, twoItems, NOW)
    expect(result).toMatchObject({ eligible: false, requiresHuman: true })
    expect(result.reason).toContain('more than one item')
  })

  it('approves exactly $50 automatically, and sends $50.01 to a person', () => {
    const exact = evaluatePolicy(
      { orderId: 'ORD-2000', issue: 'defective_item' },
      order({ items: [{ sku: 'X', name: 'Exact', unitPrice: 50, quantity: 1 }], total: 50, charges: [50] }),
      NOW,
    )
    const over = evaluatePolicy(
      { orderId: 'ORD-2000', issue: 'defective_item' },
      order({ items: [{ sku: 'X', name: 'Over', unitPrice: 50.01, quantity: 1 }], total: 50.01, charges: [50.01] }),
      NOW,
    )
    expect(AUTO_APPROVE_LIMIT).toBe(50)
    expect(exact).toMatchObject({ amount: 50, requiresHuman: false })
    expect(over).toMatchObject({ amount: 50.01, requiresHuman: true })
  })

  it('keeps day 30 inside the window and treats day 31 as outside it', () => {
    const inside = evaluatePolicy(
      { orderId: 'ORD-2000', issue: 'defective_item' },
      order({ deliveredAt: daysAgo(30) }),
      NOW,
    )
    const outside = evaluatePolicy(
      { orderId: 'ORD-2000', issue: 'defective_item' },
      order({ deliveredAt: daysAgo(31) }),
      NOW,
    )
    expect(inside.eligible).toBe(true)
    expect(outside).toMatchObject({ eligible: false, requiresHuman: false })
  })

  it('treats 30.5 days as outside the window, since the rule compares raw elapsed time', () => {
    const result = evaluatePolicy(
      { orderId: 'ORD-2000', issue: 'defective_item' },
      order({ deliveredAt: daysAgo(30.5) }),
      NOW,
    )
    expect(result).toMatchObject({ eligible: false, requiresHuman: false })
    expect(result.reason).toBe('Delivered more than 30 days ago. Refunds need a request within 30 days of delivery.')
  })
})

describe('resolveDecision: the human answer', () => {
  const proposal = { action: 'refund' as const, amount: 129, rationale: 'Two charges.' }

  it('keeps the proposal on approve, with any note', () => {
    expect(resolveDecision(proposal, { action: 'approve', note: 'Checked' })).toEqual({
      action: 'refund',
      amount: 129,
      note: 'Checked',
    })
  })

  it('denies on reject', () => {
    expect(resolveDecision(proposal, { action: 'reject' })).toEqual({ action: 'deny', amount: 0, note: null })
  })

  it('refunds the edited amount on edit', () => {
    expect(resolveDecision(proposal, { action: 'edit', amount: 100 })).toEqual({
      action: 'refund',
      amount: 100,
      note: null,
    })
  })

  it('keeps the proposal when there is no answer', () => {
    expect(resolveDecision(proposal, null)).toEqual({ action: 'refund', amount: 129, note: null })
  })
})
