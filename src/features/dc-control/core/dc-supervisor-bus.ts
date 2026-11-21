import { EventEmitter } from "node:events";

export type SupervisorSessionState =
  | "idle"          // Sesión viva esperando prompt del usuario
  | "busy"          // Ejecutando inferencia o llamada a herramientas
  | "waiting_human" // Freno manual, takeover o pregunta interactiva
  | "hung"          // Sin progreso ni latidos tras el umbral del watchdog
  | "terminated";   // Proceso cerrado o sesión finalizada

export interface SupervisorSessionInfo {
  sessionId: string;
  pid?: number;
  cwd: string;
  projectName?: string;
  model?: string;
  state: SupervisorSessionState;
  lastActivityAt: number;
  startedAt: number;
  metadata?: Record<string, unknown>;
}

export interface SessionHeartbeatEvent {
  sessionId: string;
  state: SupervisorSessionState;
  timestamp: number;
  detail?: string;
}

export interface SessionHungEvent {
  sessionId: string;
  pid?: number;
  durationMs: number;
  thresholdMs: number;
  lastState: SupervisorSessionState;
  detectedAt: number;
}

export interface SupervisorBusEvents {
  "session:discovered": (session: SupervisorSessionInfo) => void;
  "session:heartbeat": (event: SessionHeartbeatEvent) => void;
  "session:state_changed": (session: SupervisorSessionInfo, previousState: SupervisorSessionState) => void;
  "session:hung": (event: SessionHungEvent) => void;
  "session:terminated": (sessionId: string, reason?: string) => void;
}

/**
 * Bus de eventos desacoplado en memoria para el supervisor dc-control.
 * No inyecta tokens ni interactúa con la ventana de contexto de ningún modelo.
 */
export class DcSupervisorBus extends EventEmitter {
  private static instance?: DcSupervisorBus;

  public static getInstance(): DcSupervisorBus {
    if (!DcSupervisorBus.instance) {
      DcSupervisorBus.instance = new DcSupervisorBus();
    }
    return DcSupervisorBus.instance;
  }

  public emitDiscovered(session: SupervisorSessionInfo): boolean {
    return this.emit("session:discovered", session);
  }

  public emitHeartbeat(event: SessionHeartbeatEvent): boolean {
    return this.emit("session:heartbeat", event);
  }

  public emitStateChanged(session: SupervisorSessionInfo, previousState: SupervisorSessionState): boolean {
    return this.emit("session:state_changed", session, previousState);
  }

  public emitHung(event: SessionHungEvent): boolean {
    return this.emit("session:hung", event);
  }

  public emitTerminated(sessionId: string, reason?: string): boolean {
    return this.emit("session:terminated", sessionId, reason);
  }
}

export const dcSupervisorBus = DcSupervisorBus.getInstance();
