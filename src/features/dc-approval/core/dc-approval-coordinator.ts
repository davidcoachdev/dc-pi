/**
 * dc-approval-coordinator.ts — Coordinador en memoria para solicitudes y concesiones Allowed-Once.
 *
 * Implementa el patrón auditado de DeepSeek Harness:
 * - Una concesión permite exactamente una llamada ('allowed-once') y expira de inmediato.
 * - Sin escalada persistente ni permisos infinitos.
 */

import { randomBytes } from "node:crypto";
import type { ApprovalOutcome, ApprovalRequest } from "./dc-approval-types.ts";

export class DcApprovalCoordinator {
  private activeGrants = new Set<string>();

  createRequest(toolName: string, action: string, reason: string, target?: string): ApprovalRequest {
    return {
      id: `req-${Date.now()}-${randomBytes(4).toString("hex")}`,
      toolName,
      action,
      reason,
      target,
      timestamp: Date.now(),
    };
  }

  grantOnce(requestId: string): void {
    this.activeGrants.add(requestId);
  }

  /**
   * Consume la concesión unitaria. Devuelve true si existía y la elimina inmediatamente.
   */
  consumeGrant(requestId: string): boolean {
    if (this.activeGrants.has(requestId)) {
      this.activeGrants.delete(requestId);
      return true;
    }
    return false;
  }

  hasGrant(requestId: string): boolean {
    return this.activeGrants.has(requestId);
  }

  clear(): void {
    this.activeGrants.clear();
  }
}

export const dcApprovalCoordinator = new DcApprovalCoordinator();
