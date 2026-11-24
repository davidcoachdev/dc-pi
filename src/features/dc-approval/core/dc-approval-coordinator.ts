/**
 * dc-approval-coordinator.ts — Coordinador en memoria para solicitudes y concesiones Allowed-Once.
 *
 * Implementa el patrón auditado de DeepSeek Harness:
 * - Una concesión permite exactamente una llamada ('allowed-once') y expira de inmediato.
 * - Sin escalada persistente ni permisos infinitos.
 */

import { randomBytes } from "node:crypto";
import type { ApprovalRequest } from "./dc-approval-types.ts";

export const DEFAULT_GRANT_TTL_MS = 5 * 60 * 1000;

export interface GrantOnceOptions {
  ttlMs?: number;
  scope?: string;
}

interface ActiveGrant {
  expiresAt: number;
  scope?: string;
}

export class DcApprovalCoordinator {
  private activeGrants = new Map<string, ActiveGrant>();

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

  grantOnce(requestId: string, options?: GrantOnceOptions): void {
    const normalizedId = requestId.trim();
    if (!normalizedId) return;
    const now = Date.now();
    this.pruneExpired(now);
    const ttlMs = options?.ttlMs ?? DEFAULT_GRANT_TTL_MS;
    if (ttlMs <= 0) {
      this.activeGrants.delete(normalizedId);
      return;
    }
    this.activeGrants.set(normalizedId, {
      expiresAt: now + ttlMs,
      scope: options?.scope,
    });
  }

  /**
   * Consume la concesión unitaria. Devuelve true si existía (y coincide con el ámbito esperado)
   * y la elimina inmediatamente para evitar reuso o fugas de memoria.
   */
  consumeGrant(requestId: string, expectedScope?: string): boolean {
    const now = Date.now();
    this.pruneExpired(now);
    const grant = this.activeGrants.get(requestId);
    if (!grant) {
      return false;
    }
    if (grant.scope !== undefined && grant.scope !== expectedScope) {
      return false;
    }
    this.activeGrants.delete(requestId);
    return true;
  }

  hasGrant(requestId: string, expectedScope?: string): boolean {
    const now = Date.now();
    this.pruneExpired(now);
    const grant = this.activeGrants.get(requestId);
    if (!grant) {
      return false;
    }
    if (grant.scope !== undefined && grant.scope !== expectedScope) {
      return false;
    }
    return true;
  }

  revokeGrant(requestId: string): boolean {
    return this.activeGrants.delete(requestId);
  }

  pruneExpired(now: number = Date.now()): number {
    let removed = 0;
    for (const [id, grant] of this.activeGrants) {
      if (grant.expiresAt <= now) {
        this.activeGrants.delete(id);
        removed++;
      }
    }
    return removed;
  }

  getActiveGrantCount(now: number = Date.now()): number {
    this.pruneExpired(now);
    return this.activeGrants.size;
  }

  clear(): void {
    this.activeGrants.clear();
  }
}

export const dcApprovalCoordinator = new DcApprovalCoordinator();
