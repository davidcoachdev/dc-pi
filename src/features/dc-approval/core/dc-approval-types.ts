/**
 * dc-approval-types.ts — Contratos y tipos para el sistema de Aprobación Unitaria (Allowed-Once).
 *
 * Directiva 1 de DC Studio: Cero dependencias de Pi en este módulo puro.
 */

export type ApprovalOutcome = "allowed-once" | "rejected" | "cancelled";

export interface ApprovalRequest {
  id: string;
  action: string;
  toolName: string;
  reason: string;
  target?: string;
  timestamp: number;
}

export interface ApprovalDecision {
  requestId: string;
  outcome: ApprovalOutcome;
  timestamp: number;
}
