import { fetchJson } from "../../../integrations/dc-http/dc-fetch.ts";

export const BRIDGE_URL = "http://127.0.0.1:9877";

export type TtsStatus = "idle" | "playing";

export class TtsBridgeClient {
  private status: TtsStatus = "idle";
  private available: boolean | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(status: TtsStatus) => void>();

  constructor(private readonly url: string = BRIDGE_URL) {}

  getStatus(): TtsStatus {
    return this.status;
  }

  isAvailable(): boolean | null {
    return this.available;
  }

  subscribe(fn: (status: TtsStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async checkStatus(): Promise<TtsStatus> {
    try {
      const res = await fetchJson<{ status?: string; state?: string }>(`${this.url}/status`, {
        timeoutMs: 1000,
      });
      this.available = true;
      const st = String(res.status ?? res.state ?? "idle").toLowerCase();
      const newStatus: TtsStatus = st === "playing" || st === "paused" ? "playing" : "idle";
      if (newStatus !== this.status) {
        this.status = newStatus;
        this.notify();
      }
      return this.status;
    } catch {
      this.available = false;
      if (this.status !== "idle") {
        this.status = "idle";
        this.notify();
      }
      return "idle";
    }
  }

  startPolling(intervalMs: number = 1500): void {
    this.stopPolling();
    void this.checkStatus();
    this.pollTimer = setInterval(() => {
      void this.checkStatus();
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try {
        fn(this.status);
      } catch {
        /* noop */
      }
    }
  }
}

export const ttsBridgeClient = new TtsBridgeClient();
