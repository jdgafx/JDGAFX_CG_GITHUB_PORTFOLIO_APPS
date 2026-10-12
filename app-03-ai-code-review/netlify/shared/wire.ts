import type { ReviewResult } from '../../src/types'
import type { Candidate, CheckedDrop } from './review'
import type { Rebuttal, Settled } from './verify'

// What the three function requests of one review send to the browser. Types only: the browser imports this file.

/**
 * The first pass's account of itself, signed by the server. The browser carries it to the read requests and returns it
 * unchanged, a ticket for each request; it never reads it. `text` is the exact JSON the server signed (the time, the content
 * hash, the raw first-pass comments and the batches) and each seal is its HMAC for one function and batch, so a read request can
 * tell a hand-off the server made, recently, for this exact code and this exact request, from anything else.
 */
export interface Handoff {
  /** Names the review for the rate limit: the first 32 hex digits of a MAC of `text`. */
  id: string
  text: string
  /** One seal per read request, for each function and each batch, so a ticket opens that request and no other. */
  seals: { 'read-1': string[]; 'read-2': string[] }
}

/** What one read request carries: the signed text and the seal made for that function and batch. */
export interface Ticket {
  text: string
  seal: string
}

/** The reply of the pass 1 request. `result` is the view to show while the reads run: nothing in it is confirmed. */
export interface FirstPassReply {
  result: ReviewResult
  /** The comments that passed the checks, for the browser to combine with the reads. Empty means there is nothing to read. */
  candidates: Candidate[]
  dropped: CheckedDrop[]
  /** The ids of `candidates` in the batches the reads take, at most four to a batch. Empty when there is nothing to read. */
  batches: number[][]
  /** Null when no comment is left to read. */
  handoff: Handoff | null
}

/** Read 1's verdict on one candidate, already checked against the code by the server. */
export type FirstRow = Settled & { id: number }
/** Read 2's answer on one candidate, already checked against the code by the server. */
export type SecondRow = Rebuttal & { id: number }
