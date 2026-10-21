export interface SubagentLease {
  modelId: string;
  ownerPid: number;
  sessionId: string;
  acquiredAt: number;
}

export class SubagentPool {
  private leases: Map<string, SubagentLease> = new Map(); // sessionId -> lease

  acquire(sessionId: number | string, pid: number, candidates: string[]): string | null {
    if (!candidates || candidates.length === 0) return null;

    // Prune dead process leases first
    this.pruneDeadLeases();

    // Check if session already has a valid lease
    const existing = this.leases.get(String(sessionId));
    if (existing && candidates.includes(existing.modelId) && this.isPidAlive(existing.ownerPid)) {
      return existing.modelId;
    }

    // Count active leases per candidate model
    const loadMap = new Map<string, number>();
    for (const c of candidates) {
      loadMap.set(c, 0);
    }

    for (const lease of this.leases.values()) {
      if (candidates.includes(lease.modelId) && this.isPidAlive(lease.ownerPid)) {
        loadMap.set(lease.modelId, (loadMap.get(lease.modelId) || 0) + 1);
      }
    }

    // Find candidate with least load
    let bestModel = candidates[0];
    let minLoad = loadMap.get(bestModel) ?? 0;

    for (let i = 1; i < candidates.length; i++) {
      const candidate = candidates[i];
      const load = loadMap.get(candidate) ?? 0;
      if (load < minLoad) {
        minLoad = load;
        bestModel = candidate;
      }
    }

    // Assign new lease
    this.leases.set(String(sessionId), {
      modelId: bestModel,
      ownerPid: pid,
      sessionId: String(sessionId),
      acquiredAt: Date.now()
    });

    return bestModel;
  }

  release(sessionId: number | string, pid?: number): boolean {
    const key = String(sessionId);
    const lease = this.leases.get(key);
    if (!lease) return false;

    if (pid !== undefined && lease.ownerPid !== pid) {
      return false;
    }

    return this.leases.delete(key);
  }

  getActiveLeases(): SubagentLease[] {
    this.pruneDeadLeases();
    return Array.from(this.leases.values());
  }

  private isPidAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      return process.kill(pid, 0);
    } catch (e: any) {
      // ESRCH means process does not exist
      if (e?.code === 'ESRCH') {
        return false;
      }
      // EPERM means process exists but belongs to another user (still alive)
      if (e?.code === 'EPERM') {
        return true;
      }
      return false;
    }
  }

  private pruneDeadLeases() {
    for (const [sessionId, lease] of this.leases.entries()) {
      if (!this.isPidAlive(lease.ownerPid)) {
        this.leases.delete(sessionId);
      }
    }
  }
}
