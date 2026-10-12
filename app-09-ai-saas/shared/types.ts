export type Day = string;                                   // 'YYYY-MM-DD'
export type Rows = Record<Day, number>;                     // one package's range response
export type WindowDays = 30 | 90 | 365;
export type ReleaseState = 'ok' | 'failed';
export interface Release { day: Day; version: string }
export interface RunWindow { runDate: Day; L: Day; days: WindowDays; start: Day; noData: Day[];
  past: [Day, Day]; before: [Day, Day]; name: 'the past month' | 'the past three months' | 'the past year' }
export interface Growth { S1: bigint; n1: number; S0: bigint; n0: number; computable: boolean } // basis A: days with v>0
export interface Aggregates { windowTotal: bigint; last30Total: bigint; peakDay: Day; peakValue: number; growth: Growth }
export interface UnusualRow { day: Day; value: number; median: number; kind: 'spike' | 'drop';
  release: 0 | 1 | 2 | 'none' | 'unavailable'; version?: string }
export interface PackageFacts { name: string; aggregates: Aggregates; unusual: UnusualRow[]; possibleGaps: Day[]; notAssessed: Day[] }
export type FigureKind = 'day_value' | 'window_total' | 'peak_value' | 'peak_day' | 'change_pct' | 'unusual_day' | 'day';
export type Segment =
  | { t: 'text'; s: string }
  | { t: 'claim'; kind: FigureKind; package: string; span: 'window' | 'last30' | 'none'; day: string; value: string }
  | { t: 'compare'; package: string; peer: string; metric: 'window_total' | 'last30_total' | 'change_pct' | 'peak_value'; relation?: 'higher' | 'lower' };
export type Verdict = 'checked' | 'wrong' | 'unchecked' | 'neutral';
export interface ExplainRequest { target: string; names: string[]; window: RunWindow; facts: PackageFacts[];
  pastRows: Record<string, Array<[Day, number, 'no-data' | 'possible-gap' | null]>>; releaseState: Record<string, ReleaseState> }
export type ExplainResponse =
  | { ok: true; paragraph: Segment[]; servedModel: string | null; usage: { prompt: number; completion: number; reasoning: number } | null; modelMs: number }
  | { ok: false; reason: 'model-unavailable' | 'invalid:cut-off' | 'invalid:empty' | 'invalid:not-json' | 'invalid:bad-shape'; servedModel: string | null;
      /** What OpenRouter reported for the call; a withheld answer was still paid for. Absent or null when none was reported. */
      usage?: { prompt: number; completion: number; reasoning: number } | null };
/** What /api/explain actually sends: the response plus what only the function side knows (lead, 2026-10-12). */
export type ExplainReply = ExplainResponse & { newestModel: string | null; costUsd: number | null };
