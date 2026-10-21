export interface ErrorClassificationResult {
  action: 'retry' | 'failover' | 'hard_quota_abort' | 'fatal_halt' | 'ignore';
  reason: string;
  cooldownMs?: number;
}

export class ErrorClassifier {
  private transientFailures: Map<string, number> = new Map();
  private maxTransientFailures: number;
  private cooldownMs: number;

  constructor(maxTransientFailures = 3, cooldownMs = 30000) {
    this.maxTransientFailures = maxTransientFailures;
    this.cooldownMs = cooldownMs;
  }

  classify(error: any, modelId: string): ErrorClassificationResult {
    const message = (error?.message || String(error)).toLowerCase();
    const status = error?.status || error?.statusCode || 0;

    // Hard quota exhaustion
    if (
      message.includes('insufficient_quota') ||
      message.includes('quota exceeded') ||
      message.includes('exceeded your current quota') ||
      status === 429 && message.includes('quota')
    ) {
      return {
        action: 'hard_quota_abort',
        reason: `Hard quota exhaustion detected for ${modelId}`,
        cooldownMs: this.cooldownMs * 2
      };
    }

    // Fatal auth / permissions / model not found
    if (status === 401 || status === 403 || message.includes('revoked') || message.includes('model_not_found')) {
      return {
        action: 'fatal_halt',
        reason: `Fatal auth or model error (${status}) for ${modelId}`,
      };
    }

    // Rate limit 429 without explicit quota text -> treat as transient / cooldown
    if (status === 429 || message.includes('rate limit') || message.includes('too many requests')) {
      return this.trackTransient(modelId, 'Rate limit / Too many requests');
    }

    // Transient server errors 5xx
    if ((status >= 500 && status < 600) || message.includes('timeout') || message.includes('econreset') || message.includes('etimedout')) {
      return this.trackTransient(modelId, `Transient server error (${status || 'network'})`);
    }

    // Default: ignore or non-fatal tool/runtime errors
    return {
      action: 'ignore',
      reason: `Non-critical error: ${message}`
    };
  }

  private trackTransient(modelId: string, errorType: string): ErrorClassificationResult {
    const count = (this.transientFailures.get(modelId) || 0) + 1;
    this.transientFailures.set(modelId, count);

    if (count >= this.maxTransientFailures) {
      this.transientFailures.set(modelId, 0); // reset on failover trigger
      return {
        action: 'failover',
        reason: `${errorType} reached threshold (${count}/${this.maxTransientFailures}) for ${modelId}`,
        cooldownMs: this.cooldownMs
      };
    }

    return {
      action: 'retry',
      reason: `${errorType} attempt ${count}/${this.maxTransientFailures} for ${modelId}`
    };
  }

  reset(modelId?: string) {
    if (modelId) {
      this.transientFailures.delete(modelId);
    } else {
      this.transientFailures.clear();
    }
  }
}
