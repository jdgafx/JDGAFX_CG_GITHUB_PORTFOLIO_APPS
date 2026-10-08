import { formatUsd, toCents } from '../../src/lib/money'
import type { Order } from '../../src/lib/orders'
import type { Decision, DecisionAction, HumanDecision, Issue, PolicyResult } from '../../src/types'

/** Refunds up to and including this many dollars are approved without a person. */
export const AUTO_APPROVE_LIMIT = 50

/** A refund needs a request within this many days of delivery. */
export const RETURN_WINDOW_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

export interface PolicyInput {
  orderId: string | null
  issue: Issue
}

function unclear(reason: string): PolicyResult {
  return { eligible: false, reason, amount: 0, requiresHuman: true }
}

function notEligible(reason: string): PolicyResult {
  return { eligible: false, reason, amount: 0, requiresHuman: false }
}

/** The extra money charged: everything charged minus the order total, in cents. */
function duplicateCents(order: Order): number {
  const charged = order.charges.reduce((sum, charge) => sum + toCents(charge), 0)
  return charged - toCents(order.total)
}

/**
 * The refund rules, applied in order. The first rule that decides the case wins.
 * 1. No order id, no matching order, or an issue that is neither a duplicate charge nor a
 *    defective item: unclear, so a person decides.
 * 2. Delivered more than 30 days ago, or a final sale item: not eligible, no person needed.
 * 3. Duplicate charge: refund the extra charged money. No extra money is unclear.
 * 4. Defective item: refund the price of the one item on the order. Several items is unclear.
 * 5. Any amount above $50 needs a person. Amounts up to $50 are approved automatically.
 */
export function evaluatePolicy(input: PolicyInput, order: Order | undefined, now: Date): PolicyResult {
  if (!input.orderId) return unclear('The ticket does not name an order, so a person must check it.')
  if (!order) return unclear(`No order matches ${input.orderId}, so a person must check it.`)
  if (input.issue === 'other') {
    return unclear('The ticket is not a duplicate charge or a defective item, so a person must decide.')
  }

  // Raw elapsed time, not whole days: 30.5 days is already outside a 30-day window.
  const elapsedDays = (now.getTime() - Date.parse(order.deliveredAt)) / DAY_MS
  if (elapsedDays > RETURN_WINDOW_DAYS) {
    const when =
      elapsedDays < RETURN_WINDOW_DAYS + 1 ? `more than ${RETURN_WINDOW_DAYS} days ago` : `${Math.floor(elapsedDays)} days ago`
    return notEligible(`Delivered ${when}. Refunds need a request within ${RETURN_WINDOW_DAYS} days of delivery.`)
  }
  if (order.finalSale) return notEligible('Final sale orders cannot be refunded.')

  let amountCents: number
  let basis: string
  if (input.issue === 'duplicate_charge') {
    amountCents = duplicateCents(order)
    if (amountCents <= 0) {
      return unclear('The order shows no extra charge, so a person must check the payment before any refund.')
    }
    basis = `The order was charged ${order.charges.length} times. The extra charge is refundable.`
  } else {
    if (order.items.length !== 1) {
      return unclear('The order has more than one item, so a person must find the defective one.')
    }
    const [item] = order.items
    amountCents = toCents(item.unitPrice) * item.quantity
    basis = `${item.name} is defective and the order is inside the return window. The item price is refundable.`
  }

  const amount = amountCents / 100
  const requiresHuman = amountCents > toCents(AUTO_APPROVE_LIMIT)
  const reason = requiresHuman
    ? `${basis} ${formatUsd(amount)} is over ${formatUsd(AUTO_APPROVE_LIMIT)}, so a person must approve it.`
    : `${basis} ${formatUsd(amount)} is within the automatic limit of ${formatUsd(AUTO_APPROVE_LIMIT)}.`
  return { eligible: true, reason, amount, requiresHuman }
}

export interface FinalDecision {
  action: DecisionAction
  amount: number
  note: string | null
}

/**
 * The outcome after the human answered. Approve keeps the proposal, reject denies, and edit
 * refunds the edited amount. With no answer, which only happens on the automatic path, the proposal stands.
 */
export function resolveDecision(proposal: Decision, human: HumanDecision | null): FinalDecision {
  const note = human?.note ?? null
  if (!human || human.action === 'approve') return { action: proposal.action, amount: proposal.amount, note }
  if (human.action === 'reject') return { action: 'deny', amount: 0, note }
  return { action: 'refund', amount: human.amount ?? 0, note }
}
