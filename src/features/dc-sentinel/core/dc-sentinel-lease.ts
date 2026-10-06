/**
 * DC Sentinel — Subagent Invocation Lease Protocol (Fase 4)
 *
 * Inspirado en j0k3r-pi (`lease.ts`) y OpenHuman:
 * 1. Otorga una identidad inmutable temporal a cada subagente lanzado.
 * 2. Si el subagente termina sin haber producido cambios ni lecciones (sesión vacía o fallida),
 *    marca la sesión para poda terminal automática, evitando acumular basura o zombis en la BD.
 * 3. Si produjo lecciones de valor, las asocia formalmente al proyecto padre.
 */

export interface SubagentLease {
  leaseId: string;
  agentName: string;
  parentSessionId: string;
  task: string;
  startedAt: number;
  endedAt?: number;
  isError?: boolean;
  hasProducedValue: boolean;
  notesCreatedCount: number;
}

export interface ReleaseLeaseOutcome {
  lease: SubagentLease;
  shouldPrune: boolean; // True si la sesión fue efímera y vacía sin valor que deba persistirse
}

export class SubagentLeaseManager {
  private leases = new Map<string, SubagentLease>();

  createLease(parentSessionId: string, agentName: string, task: string): SubagentLease {
    const leaseId = `lease-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const lease: SubagentLease = {
      leaseId,
      agentName,
      parentSessionId,
      task: (task || "").trim(),
      startedAt: Date.now(),
      hasProducedValue: false,
      notesCreatedCount: 0,
    };

    this.leases.set(leaseId, lease);
    return lease;
  }

  getLease(leaseId: string): SubagentLease | undefined {
    return this.leases.get(leaseId);
  }

  recordNoteProduced(leaseId: string): void {
    const lease = this.leases.get(leaseId);
    if (lease) {
      lease.hasProducedValue = true;
      lease.notesCreatedCount++;
    }
  }

  releaseLease(leaseId: string, isError: boolean = false): ReleaseLeaseOutcome | null {
    const lease = this.leases.get(leaseId);
    if (!lease) return null;

    lease.endedAt = Date.now();
    lease.isError = isError;

    // Si no produjo notas ni cambios y fue error o ejecución vacía -> purgar
    const shouldPrune = !lease.hasProducedValue && lease.notesCreatedCount === 0;

    this.leases.delete(leaseId);

    return {
      lease,
      shouldPrune,
    };
  }

  getActiveLeasesCount(): number {
    return this.leases.size;
  }

  clear(): void {
    this.leases.clear();
  }
}

export const globalLeaseManager = new SubagentLeaseManager();
