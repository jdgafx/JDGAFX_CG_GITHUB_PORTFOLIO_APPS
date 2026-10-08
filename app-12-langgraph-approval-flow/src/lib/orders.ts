export interface OrderItem {
  sku: string
  name: string
  /** Dollars for one unit. */
  unitPrice: number
  quantity: number
}

export interface Order {
  id: string
  customer: string
  items: OrderItem[]
  /** The order total in dollars. */
  total: number
  /** Every amount charged to the card for this order, in dollars. A duplicate charge is a second entry. */
  charges: number[]
  orderedAt: string
  deliveredAt: string
  status: 'delivered'
  finalSale: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The sample order table, with dates counted back from `now`. The 30-day rule then gives the
 * same answers on any day the app runs, and the sample tickets keep their intended outcomes.
 */
export function sampleOrders(now: Date = new Date()): Order[] {
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString()
  return [
    {
      id: 'ORD-1042',
      customer: 'Maya Chen',
      items: [{ sku: 'HDX-220', name: 'Noise-cancelling headphones', unitPrice: 129, quantity: 1 }],
      total: 129,
      charges: [129, 129],
      orderedAt: daysAgo(10),
      deliveredAt: daysAgo(6),
      status: 'delivered',
      finalSale: false,
    },
    {
      id: 'ORD-1077',
      customer: 'Owen Brooks',
      items: [{ sku: 'MSE-14', name: 'Wireless mouse', unitPrice: 24.5, quantity: 1 }],
      total: 24.5,
      charges: [24.5],
      orderedAt: daysAgo(14),
      deliveredAt: daysAgo(9),
      status: 'delivered',
      finalSale: false,
    },
    {
      id: 'ORD-1031',
      customer: 'Priya Raman',
      items: [{ sku: 'DSK-7', name: 'Standing desk frame', unitPrice: 389, quantity: 1 }],
      total: 389,
      charges: [389],
      orderedAt: daysAgo(20),
      deliveredAt: daysAgo(12),
      status: 'delivered',
      finalSale: false,
    },
    {
      id: 'ORD-0998',
      customer: 'Luis Ortega',
      items: [{ sku: 'LMP-3', name: 'Desk lamp', unitPrice: 42, quantity: 1 }],
      total: 42,
      charges: [42],
      orderedAt: daysAgo(60),
      deliveredAt: daysAgo(47),
      status: 'delivered',
      finalSale: false,
    },
    {
      id: 'ORD-1055',
      customer: 'Sam Okafor',
      items: [{ sku: 'SOX-9', name: 'Clearance sock bundle', unitPrice: 18, quantity: 1 }],
      total: 18,
      charges: [18],
      orderedAt: daysAgo(5),
      deliveredAt: daysAgo(3),
      status: 'delivered',
      finalSale: true,
    },
  ]
}

/** The order with this id, or undefined when no order matches. */
export function findOrder(orders: readonly Order[], orderId: string | null): Order | undefined {
  return orderId ? orders.find((order) => order.id === orderId) : undefined
}
