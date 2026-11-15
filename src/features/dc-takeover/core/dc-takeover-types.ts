/**
 * dc-takeover-types.ts — Canonical contracts for Human Takeover requests.
 *
 * Directive 1 of DC Studio: zero Pi dependencies in this pure module.
 */

export type TakeoverOutcome = "continued" | "retry" | "aborted";

export interface TakeoverRequest {
  id: string;
  title: string;
  reason: string;
  suggestedAction: string;
  timeoutMs?: number;
  createdAt: number;
}

export interface TakeoverResult {
  outcome: TakeoverOutcome;
  note?: string;
}
