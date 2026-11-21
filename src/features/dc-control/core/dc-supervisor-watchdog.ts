import { dcSupervisorBus, type SupervisorSessionInfo, type SessionHungEvent } from "./dc-supervisor-bus.ts";
import type { DcSessionRegistry } from "./dc-session-registry.ts";

export interface WatchdogOptions {
  checkIntervalMs?: number;    // Intervalo de evaluación (default: 10_000ms = 10s)
  hungThresholdMs?: number;     // Tiempo en estado 'busy' sin actividad para clasificar como 'hung' (default: 180_000ms = 3m)
  idleThresholdMs?: number;     // Tiempo tras el cual una sesión pasa de 'busy' a 'idle' si no hay actividad (default: 60_000ms = 1m)
}

export class DcSupervisorWatchdog {
  private registry: DcSessionRegistry;
  private checkIntervalMs: number;
  private hungThresholdMs: number;
  private idleThresholdMs: number;
  private timer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(registry: DcSessionRegistry, options?: WatchdogOptions) {
    this.registry = registry;
    this.checkIntervalMs = options?.checkIntervalMs ?? 10_000;
    this.hungThresholdMs = options?.hungThresholdMs ?? 180_000;
    this.idleThresholdMs = options?.idleThresholdMs ?? 60_000;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.evaluateSessions().catch(() => {
        // Safe watchdog tick
      });
    }, this.checkIntervalMs);
    // Desacoplar del event loop para no bloquear terminación de procesos en tests
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  public get active(): boolean {
    return this.isRunning;
  }

  /**
   * Evalúa la salud de las sesiones registradas y detecta cuelgues de manera out-of-band.
   */
  public async evaluateSessions(now: number = Date.now()): Promise<SessionHungEvent[]> {
    const sessions = this.registry.listSessions({ onlyActive: true });
    const hungAlerts: SessionHungEvent[] = [];

    for (const session of sessions) {
      const elapsedSinceActivity = now - session.lastActivityAt;

      // 1. Detección de cuelgue: la sesión estaba 'busy' y ha superado el umbral de actividad
      if (session.state === "busy" && elapsedSinceActivity >= this.hungThresholdMs) {
        const prev = session.state;
        session.state = "hung";
        this.registry.upsertSession(session);

        const hungEvent: SessionHungEvent = {
          sessionId: session.sessionId,
          pid: session.pid,
          durationMs: elapsedSinceActivity,
          thresholdMs: this.hungThresholdMs,
          lastState: prev,
          detectedAt: now,
        };

        hungAlerts.push(hungEvent);
        dcSupervisorBus.emitHung(hungEvent);
      }
      // 2. Transición natural de busy a idle si no llega a hung pero supera el umbral de descanso
      else if (session.state === "busy" && elapsedSinceActivity >= this.idleThresholdMs) {
        session.state = "idle";
        this.registry.upsertSession(session);
      }
    }

    return hungAlerts;
  }

  /**
   * Recibe un latido directo de un orquestador o subagente y actualiza su estado.
   */
  public recordHeartbeat(sessionId: string, state: SupervisorSessionInfo["state"] = "busy", now: number = Date.now()): void {
    const session = this.registry.getSession(sessionId);
    if (session) {
      session.lastActivityAt = now;
      session.state = state;
      this.registry.upsertSession(session);
      dcSupervisorBus.emitHeartbeat({
        sessionId,
        state,
        timestamp: now,
      });
    }
  }
}
