export interface QuotaWindow {
  usedPercent: number;
  limitWindowSeconds: number;
  resetAt?: string;
}

export interface CandidateQuotaStatus {
  candidateId: string;
  windows: QuotaWindow[];
  isVerified: boolean;
  insufficientQuota?: boolean;
}

export interface QuotaManagerOptions {
  quotaThresholdPercent?: number; // e.g. 95%
}

export class QuotaManager {
  private threshold: number;

  constructor(options?: QuotaManagerOptions) {
    this.threshold = options?.quotaThresholdPercent ?? 95.0;
  }

  selectBestCandidate(savedSlots: string[], statuses: CandidateQuotaStatus[]): string | null {
    if (!savedSlots || savedSlots.length === 0) return null;

    const statusMap = new Map<string, CandidateQuotaStatus>();
    for (const s of statuses) {
      statusMap.set(s.candidateId, s);
    }

    // Evaluate saved slots in strict priority order
    for (const slotId of savedSlots) {
      const status = statusMap.get(slotId);
      if (!status || !status.isVerified || status.insufficientQuota) {
        continue;
      }

      // Check if all windows are below the threshold (e.g. < 95% used)
      let eligible = true;
      if (status.windows && status.windows.length > 0) {
        for (const win of status.windows) {
          if (win.usedPercent >= this.threshold) {
            eligible = false;
            break;
          }
        }
      }

      if (eligible) {
        return slotId;
      }
    }

    // Fallback to first saved slot if none pass strictly, or null if all exhausted
    return null;
  }
}
