/** Shown when the server keeps checkpoints in memory. The server sends the same wording. */
export const MEMORY_NOTE =
  'Checkpoints are kept in memory on this server because Netlify Blobs is not configured here. An approval can be lost on reload.'

export interface SampleTicket {
  id: 'duplicate' | 'defect'
  label: string
  outcome: string
  text: string
}

/** Two tickets that the sample orders answer. One needs a person, and one is approved automatically. */
export const SAMPLE_TICKETS: readonly SampleTicket[] = [
  {
    id: 'duplicate',
    label: 'Duplicate charge, $129.00',
    outcome: 'Needs a person: the refund is over $50.',
    text: 'Hi, I was charged twice for order ORD-1042 on my card. Both charges were $129.00. Please refund the extra one.',
  },
  {
    id: 'defect',
    label: 'Defective mouse, $24.50',
    outcome: 'Approved automatically: under $50.',
    text: 'Hello, order ORD-1077 arrived with a cracked case and the scroll wheel does not work. Please refund the mouse.',
  },
]
