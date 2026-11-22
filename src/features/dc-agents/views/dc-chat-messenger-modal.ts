import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { openDcModal } from "../../../ui/dc-modal.ts";
import {
  dcChatDatabase,
  type ChatThread,
  type ChatMessageRecord,
} from "../daemon/dc-chat-sqlite-db.ts";

/**
 * Panel interactivo tipo "WhatsApp / Messenger" para Super-Agentes:
 * - Panel Izquierdo: Lista de hilos/conversaciones (Issues, Terceros, Agentes) con conteo de no leídos.
 * - Panel Derecho: Historial de mensajes, réplicas citadas y respuestas del Super-Agente.
 */
export class DcChatMessengerPanel implements Component {
  private threads: ChatThread[] = [];
  private selectedThreadIndex = 0;
  private messages: ChatMessageRecord[] = [];
  private isFocusOnMessages = false;
  private messageScrollOffset = 0;

  constructor(
    private readonly theme: Theme,
    private readonly onClose: () => void,
    private readonly requestRender?: () => void,
  ) {
    this.refresh();
  }

  private refresh(): void {
    this.threads = dcChatDatabase.listThreads();
    if (this.threads.length === 0) {
      // Si aún no hay hilos reales, registrar uno informativo
      dcChatDatabase.upsertThread({
        id: "general-86",
        title: "Super-Agente #86 • General",
        participant: "super_agent_86",
        unreadCount: 0,
        updatedAt: Date.now(),
      });
      dcChatDatabase.addMessage({
        id: `welcome-${Date.now()}`,
        threadId: "general-86",
        sender: "super_agent_86",
        senderRole: "agent",
        incomingText: "Buzón de mensajería autónomo inicializado en SQLite.",
        replyText: "Listo para supervisar y registrar réplicas de comentarios de GitHub.",
        status: "sent",
        timestamp: Date.now(),
      });
      this.threads = dcChatDatabase.listThreads();
    }

    if (this.selectedThreadIndex >= this.threads.length) {
      this.selectedThreadIndex = Math.max(0, this.threads.length - 1);
    }

    const currentThread = this.threads[this.selectedThreadIndex];
    if (currentThread) {
      this.messages = dcChatDatabase.getMessagesForThread(currentThread.id);
      dcChatDatabase.markThreadRead(currentThread.id);
    } else {
      this.messages = [];
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const w = Math.max(64, width);
    const innerW = w - 2;
    const lines: string[] = [];

    const bloodBright = (s: string) => `\x1b[38;2;255;51;51m${s}\x1b[0m`;
    const bloodSoft = (s: string) => `\x1b[38;2;255;128;128m${s}\x1b[0m`;
    const greenBright = (s: string) => `\x1b[38;2;46;204;113m${s}\x1b[0m`;
    const yellowBright = (s: string) => `\x1b[38;2;250;204;21m${s}\x1b[0m`;
    const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
    const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

    const leftColW = Math.min(32, Math.max(22, Math.floor(innerW * 0.35)));
    const rightColW = innerW - leftColW - 1;

    // Encabezado
    const titleBar = ` ${bold("💬 DC MESSENGER")} ${dim("·")} ${bloodSoft("Historial Soberano SQLite")} ${dim("─".repeat(Math.max(2, innerW - 40)))} ${dim("[Esc: Salir]")}`;
    lines.push(titleBar);
    lines.push(dim("─".repeat(innerW)));

    // Preparar líneas de la columna izquierda (Hilos)
    const leftLines: string[] = [];
    leftLines.push(bold("Hilos & Issues"));
    leftLines.push(dim("─".repeat(leftColW)));

    for (let i = 0; i < this.threads.length; i++) {
      const th = this.threads[i]!;
      const isSel = i === this.selectedThreadIndex;
      const pointer = isSel ? bloodBright("▶ ") : "  ";
      const badge = th.unreadCount > 0 ? bloodBright(` (${th.unreadCount})`) : "";
      const rawTitle = `${th.title}${badge}`;
      const title = truncateToWidth(rawTitle, leftColW - 3, "…");
      const part = truncateToWidth(`  ${dim(th.participant)}`, leftColW - 1, "");

      if (isSel) {
        leftLines.push(`\x1b[7m${pointer}${title}\x1b[27m`);
      } else {
        leftLines.push(`${pointer}${title}`);
      }
      leftLines.push(part);
      leftLines.push("");
    }

    // Preparar líneas de la columna derecha (Mensajes del hilo activo)
    const rightLines: string[] = [];
    const activeThread = this.threads[this.selectedThreadIndex];

    if (activeThread) {
      rightLines.push(`${bold(greenBright("●"))} ${bold(activeThread.title)} ${dim(`(${activeThread.participant})`)}`);
      rightLines.push(dim("─".repeat(rightColW)));

      if (this.messages.length === 0) {
        rightLines.push(dim("  (Sin mensajes en este hilo)"));
      } else {
        for (const msg of this.messages) {
          const dateStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const isThird = msg.senderRole === "third_party";
          const senderLabel = isThird
            ? `${yellowBright(`@${msg.sender}`)} ${dim(`[${dateStr}]`)}`
            : `${greenBright(`🤖 Super-Agent 86`)} ${dim(`[${dateStr}]`)}`;

          rightLines.push(senderLabel);

          // Si hay réplica / cita previa
          if (msg.quotedText) {
            const quoteLines = msg.quotedText.split("\n");
            for (const ql of quoteLines) {
              rightLines.push(`  ${dim("│")} ${dim(ql.replace(/^>\s*/, ""))}`);
            }
          }

          // Mensaje recibido
          const inLines = this.wrapText(msg.incomingText, rightColW - 4);
          for (const il of inLines) {
            rightLines.push(`  ${msg.isMalicious ? bloodBright(il) : il}`);
          }

          // Respuesta dada por el bot si existe
          if (msg.replyText) {
            rightLines.push(`  ${greenBright("↳")} ${dim("Respuesta enviada:")}`);
            const repLines = this.wrapText(msg.replyText, rightColW - 6);
            for (const rl of repLines) {
              rightLines.push(`    ${greenBright("┃")} ${rl}`);
            }
          }
          rightLines.push("");
        }
      }
    } else {
      rightLines.push(dim("Selecciona un hilo a la izquierda."));
    }

    // Componer ambas columnas lado a lado
    const maxRows = Math.max(leftLines.length, rightLines.length, 16);
    for (let r = 0; r < maxRows; r++) {
      const lText = leftLines[r] ?? "";
      const rText = rightLines[r] ?? "";
      const lPadded = lText + " ".repeat(Math.max(0, leftColW - visibleWidth(lText)));
      const rPadded = truncateToWidth(rText, rightColW, "");
      lines.push(`${lPadded} ${dim("│")} ${rPadded}`);
    }

    lines.push(dim("─".repeat(innerW)));
    lines.push(dim("↑/↓: navegar hilos | Tab: cambiar | Esc: cerrar ventana"));

    return lines;
  }

  private wrapText(text: string, maxWidth: number): string[] {
    const words = text.split(/\s+/);
    const result: string[] = [];
    let cur = "";

    for (const word of words) {
      if (!cur) {
        cur = word;
      } else if (visibleWidth(cur + " " + word) <= maxWidth) {
        cur += " " + word;
      } else {
        result.push(cur);
        cur = word;
      }
    }
    if (cur) result.push(cur);
    return result.length > 0 ? result : ["(vacío)"];
  }

  handleInput(data: string): boolean | void {
    if (matchesKey(data, Key.escape)) {
      this.onClose();
      return true;
    }

    if (matchesKey(data, Key.up)) {
      if (this.selectedThreadIndex > 0) {
        this.selectedThreadIndex--;
        const currentThread = this.threads[this.selectedThreadIndex];
        if (currentThread) {
          this.messages = dcChatDatabase.getMessagesForThread(currentThread.id);
          dcChatDatabase.markThreadRead(currentThread.id);
        }
        this.requestRender?.();
      }
      return true;
    }

    if (matchesKey(data, Key.down)) {
      if (this.selectedThreadIndex < this.threads.length - 1) {
        this.selectedThreadIndex++;
        const currentThread = this.threads[this.selectedThreadIndex];
        if (currentThread) {
          this.messages = dcChatDatabase.getMessagesForThread(currentThread.id);
          dcChatDatabase.markThreadRead(currentThread.id);
        }
        this.requestRender?.();
      }
      return true;
    }

    return undefined;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "click" && event.button === "left") {
      this.requestRender?.();
      return { handled: true };
    }
    return undefined;
  }
}

/**
 * Abre el visor completo de Chat Messenger de Super-Agentes respaldado en SQLite.
 */
export async function openAgentChatMessengerModal(ctx: ExtensionContext): Promise<void> {
  await openDcModal(ctx, {
    title: "💬 DC Studio • Super-Agent Messenger (SQLite)",
    content: (done, theme, tui) => {
      return new DcChatMessengerPanel(
        theme,
        () => done(),
        () => {
          try { (tui as any)?.requestRender?.(); } catch {}
        },
      );
    },
  });
}
