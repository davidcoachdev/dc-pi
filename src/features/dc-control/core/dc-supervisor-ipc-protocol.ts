import type { SupervisorSessionState } from "./dc-supervisor-bus.ts";

export type SessionRole = "orchestrator" | "super_agent_86" | "super_agent_99" | "worker";

export const DEFAULT_MAX_IPC_BUFFER_BYTES = 256 * 1024; // 256 KiB

export function getIpcAuthTokenPath(socketPath: string): string {
  return `${socketPath}.token`;
}

// Eventos que los clientes (sesiones Pi / Super-Agentes) envían a dc-control
export type ClientToSupervisorMessage =
  | {
      type: "session_online";
      sessionId: string;
      authToken?: string;
      role: SessionRole;
      pid: number;
      cwd: string;
      projectName?: string;
      model?: string;
      timestamp: number;
    }
  | {
      type: "heartbeat";
      sessionId: string;
      state: SupervisorSessionState;
      currentTask?: string;
      timestamp: number;
    }
  | {
      type: "request_takeover"; // Freno manual o duda interactiva
      sessionId: string;
      reason: string;
      suggestedAction: string;
      question?: string;
      options?: string[];
      timestamp: number;
    }
  | {
      type: "peer_message"; // Comunicación entre pares coordinada por dc-control
      fromSessionId: string;
      toSessionId?: string; // Si se omite, es broadcast a todos los pares
      topic: string;
      payload: unknown;
      timestamp: number;
    }
  | {
      type: "session_offline";
      sessionId: string;
      reason?: string;
      timestamp: number;
    }
  | {
      type: "query_sessions"; // Cliente consulta las sesiones activas en vivo
      fromSessionId: string;
      timestamp: number;
    };

// Eventos y directivas que dc-control envía a las sesiones
export type SupervisorToClientMessage =
  | {
      type: "ack_registration";
      sessionId: string;
      supervisorPid: number;
      timestamp: number;
    }
  | {
      type: "auth_error";
      reason: string;
      timestamp: number;
    }
  | {
      type: "takeover_decision"; // Decisión humana provista por el supervisor
      sessionId: string;
      decision: "continue" | "retry" | "abort";
      selectedOption?: string;
      instruction?: string;
      timestamp: number;
    }
  | {
      type: "peer_message_forward"; // Mensaje entregado desde otro par
      fromSessionId: string;
      topic: string;
      payload: unknown;
      timestamp: number;
    }
  | {
      type: "emergency_stop"; // Detención forzosa por cuelgue, cuota o directiva global
      sessionId: string;
      reason: string;
      timestamp: number;
    }
  | {
      type: "sessions_report"; // Lista de sesiones conectadas al socket en tiempo real
      sessions: Array<{
        sessionId: string;
        pid?: number;
        cwd: string;
        projectName?: string;
        model?: string;
        state: SupervisorSessionState;
        role?: string;
        lastActivityAt: number;
      }>;
      timestamp: number;
    }
  | {
      type: "sessions_changed"; // Notificación broadcast en vivo cuando un cliente se conecta/desconecta
      action: "connected" | "disconnected" | "state_changed";
      sessionId: string;
      role?: string;
      timestamp: number;
    };
