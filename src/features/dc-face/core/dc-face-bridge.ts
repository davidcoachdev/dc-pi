import { fetchJson } from "../../../integrations/dc-http/dc-fetch.ts";

export const BRIDGE_URL = "http://127.0.0.1:9877";

export type TtsStatus = "idle" | "playing";

export class TtsBridgeClient {
  private status: TtsStatus = "idle";
  private rate: number = 1.0;
  private available: boolean | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(status: TtsStatus) => void>();

  constructor(private readonly url: string = BRIDGE_URL) {}

  getStatus(): TtsStatus {
    return this.status;
  }

  getRate(): number {
    return this.rate;
  }

  setRate(nextRate: number): void {
    if (!Number.isFinite(nextRate) || nextRate <= 0) return;
    const clamped = Math.min(2.5, Math.max(0.4, nextRate));
    if (clamped !== this.rate) {
      this.rate = clamped;
      this.notify();
    }
  }

  setStatus(next: TtsStatus, nextRate?: number): void {
    this.available = true;
    let changed = false;
    if (typeof nextRate === "number" && Number.isFinite(nextRate) && nextRate > 0) {
      const clamped = Math.min(2.5, Math.max(0.4, nextRate));
      if (clamped !== this.rate) {
        this.rate = clamped;
        changed = true;
      }
    }
    if (next !== this.status) {
      this.status = next;
      changed = true;
    }
    if (changed) {
      this.notify();
    }
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
      const res = await fetchJson<{ status?: string; state?: string; rate?: number }>(`${this.url}/status`, {
        timeoutMs: 1000,
      });
      this.available = true;
      const st = String(res.status ?? res.state ?? "idle").toLowerCase();
      const newStatus: TtsStatus = st === "playing" ? "playing" : "idle";
      this.setStatus(newStatus, res.rate);
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

  /**
   * Directiva 6: Cero polling ciego continuo en reposo.
   * No ejecuta setInterval continuo a 127.0.0.1:9877 para prevenir memory leaks y CPU churn.
   * Se reserva checkStatus() para invocaciones explícitas bajo demanda.
   */
  startPolling(_intervalMs: number = 1500): void {
    this.stopPolling();
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

export const G_TTS_BRIDGE_CLIENT = Symbol.for("dc.face.tts-bridge-client");

export const ttsBridgeClient: TtsBridgeClient =
  (globalThis as any)[G_TTS_BRIDGE_CLIENT] ??
  ((globalThis as any)[G_TTS_BRIDGE_CLIENT] = new TtsBridgeClient());
