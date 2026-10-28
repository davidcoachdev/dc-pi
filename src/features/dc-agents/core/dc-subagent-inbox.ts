import { AgentSession } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../../integrations/dc-notify/dc-notifier.ts";

export const ORIGINAL_SEND_CUSTOM_MESSAGE = Symbol.for("dc.inbox.original-send-custom-message");
export const PASSIVE_INBOX_PATCHED = Symbol.for("dc.inbox.patched");

export interface BackgroundTaskReport {
  id: string;
  taskId: string;
  agent: string;
  label?: string;
  status: "completed" | "failed" | "cancelled" | "timed_out";
  outcomeText: string;
  receivedAt: number;
  read: boolean;
  errorDetails?: {
    summary: string;
    rootCause?: string;
    falsifiedPremises?: string[];
    recoverySteps?: string[];
  };
}

class SubagentInboxManager {
  private reports: Map<string, BackgroundTaskReport> = new Map();
  private listeners: Set<(report: BackgroundTaskReport) => void> = new Set();

  deposit(report: BackgroundTaskReport): void {
    this.reports.set(report.taskId, report);
    for (const listener of this.listeners) {
      try {
        listener(report);
      } catch {
        /* best-effort notification */
      }
    }
  }

  get(taskId: string): BackgroundTaskReport | undefined {
    return this.reports.get(taskId);
  }

  list(onlyUnread = false): BackgroundTaskReport[] {
    const list = Array.from(this.reports.values()).sort((a, b) => b.receivedAt - a.receivedAt);
    return onlyUnread ? list.filter((r) => !r.read) : list;
  }

  markRead(taskId: string): boolean {
    const report = this.reports.get(taskId);
    if (report) {
      report.read = true;
      return true;
    }
    return false;
  }

  subscribe(listener: (report: BackgroundTaskReport) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.reports.clear();
  }
}

export const subagentInboxManager = new SubagentInboxManager();

/**
 * Parchea AgentSession.prototype.sendCustomMessage para interceptar los mensajes de tipo
 * `gentle-agents.wake` o completions de subagentes en background.
 *
 * En lugar de ejecutar `triggerTurn: true` y secuestrar la terminal mientras el usuario
 * está en un turno interactivo o escribiendo, almacena el reporte en el `subagentInboxManager`,
 * emite un aviso visual sobrio (toast/notificación) y deposita el mensaje en el historial
 * con `triggerTurn: false`.
 */
export function installSubagentInboxInterceptor(): boolean {
  const proto = (AgentSession as any)?.prototype as Record<string | symbol, any> | undefined;
  if (!proto) return false;

  if (proto[PASSIVE_INBOX_PATCHED]) {
    return true;
  }

  const origSendCustomMessage = proto.sendCustomMessage;
  proto[ORIGINAL_SEND_CUSTOM_MESSAGE] = origSendCustomMessage;
  proto[PASSIVE_INBOX_PATCHED] = true;

  proto.sendCustomMessage = async function (message: any, options?: any) {
    const customType = String(message?.customType || "");

    // 1. Interceptar el Wake agresivo de gentle-agents
    if (customType === "gentle-agents.wake") {
      // Ignorar el triggerTurn automático forzado del wake de gentle-pi
      // para no secuestrar la terminal del usuario.
      if (options?.triggerTurn) {
        return;
      }
    }

    // 2. Interceptar el resultado de un subagente (gentle-agents.result)
    if (customType === "gentle-agents.result") {
      const details = message?.details?.gentleAgents || message?.details || {};
      const taskId = String(details?.taskId || details?.task_id || `task-${Date.now()}`);
      const agent = String(details?.agent || "subagent");
      const label = details?.label ? String(details.label) : undefined;
      const status = (details?.status || "completed") as BackgroundTaskReport["status"];
      const outcomeText = typeof message?.content === "string"
        ? message.content
        : Array.isArray(message?.content)
        ? message.content.map((c: any) => c.text || "").join("\n")
        : JSON.stringify(message?.content ?? "");

      const report: BackgroundTaskReport = {
        id: `report-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        taskId,
        agent,
        label,
        status,
        outcomeText,
        receivedAt: Date.now(),
        read: false,
      };

      subagentInboxManager.deposit(report);

      // Notificación visual no invasiva en UI
      try {
        const badge = status === "completed" ? "✅" : "⚠️";
        dcNotifier.notifyHerdr(
          `${badge} Subagente ${agent} finalizado`,
          label ? `Tarea: ${label} (ID: ${taskId})` : `ID: ${taskId}`,
        );
      } catch {
        /* best-effort */
      }

      // Si el autor original envió triggerTurn: true, degradarlo a triggerTurn: false
      // para que el resultado se agregue al historial de mensajes sin interrumpir el hilo
      const safeOptions = options ? { ...options, triggerTurn: false } : { triggerTurn: false };
      return origSendCustomMessage.call(this, message, safeOptions);
    }

    return origSendCustomMessage.call(this, message, options);
  };

  return true;
}

export function uninstallSubagentInboxInterceptor(): void {
  const proto = (AgentSession as any)?.prototype as Record<string | symbol, any> | undefined;
  if (!proto || !proto[PASSIVE_INBOX_PATCHED]) return;

  if (proto[ORIGINAL_SEND_CUSTOM_MESSAGE]) {
    proto.sendCustomMessage = proto[ORIGINAL_SEND_CUSTOM_MESSAGE];
    delete proto[ORIGINAL_SEND_CUSTOM_MESSAGE];
  }
  delete proto[PASSIVE_INBOX_PATCHED];
}
