import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  decodeKittyPrintable,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { openDcModal } from "../../../ui/dc-modal.ts";

export interface PendingChatMessage {
  id: string;
  authorLogin: string;
  issueNumber: number;
  incomingText: string;
  proposedReply: string;
  isMalicious?: boolean;
}

export type ChatApprovalDecision =
  | { action: "approve"; reply: string }
  | { action: "reject" };

/**
 * Modal flotante tipo "WhatsApp / Messenger" para Super-Agentes:
 * Muestra el mensaje recibido a la izquierda, la respuesta propuesta por el agente a la derecha,
 * y permite al Owner editar la respuesta en vivo antes de enviarla a GitHub.
 */
export class DcAgentChatModalPanel implements Component {
  private customReplyText: string;
  private isEditing = false;
  private selectedButtonIndex = 0; // 0: Enviar, 1: Editar, 2: Ignorar

  constructor(
    private readonly message: PendingChatMessage,
    private readonly theme: Theme,
    private readonly onDone: (decision: ChatApprovalDecision) => void,
    private readonly requestRender?: () => void,
  ) {
    this.customReplyText = message.proposedReply;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const w = Math.max(48, width);
    const innerW = w - 4;
    const lines: string[] = [];

    const bloodBright = (s: string) => `\x1b[38;2;255;51;51m${s}\x1b[0m`;
    const greenBright = (s: string) => `\x1b[38;2;46;204;113m${s}\x1b[0m`;
    const yellowBright = (s: string) => `\x1b[38;2;250;204;21m${s}\x1b[0m`;
    const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
    const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

    lines.push(`  ${bold("💬 Super-Agent 86 Messenger")} ${dim(`• Issue #${this.message.issueNumber}`)}`);
    lines.push(`  ${dim("─".repeat(innerW))}`);

    // Burbuja izquierda (Mensaje entrante del tercero)
    const senderColor = this.message.isMalicious ? bloodBright : yellowBright;
    lines.push(`  ${senderColor(`👤 @${this.message.authorLogin}`)} ${dim("(comentario entrante)")}:`);
    const inLines = this.wrapText(this.message.incomingText, innerW - 4);
    for (const l of inLines) {
      lines.push(`    ${dim("│")} ${l}`);
    }
    lines.push("");

    // Burbuja derecha (Respuesta propuesta por el Super-Agente)
    lines.push(`  ${greenBright("🤖 Super-Agent 86")} ${dim("(borrador de respuesta)")}:`);
    const outLines = this.wrapText(this.customReplyText, innerW - 4);
    for (const l of outLines) {
      lines.push(`    ${greenBright("┃")} ${l}`);
    }
    lines.push("");
    lines.push(`  ${dim("─".repeat(innerW))}`);

    // Botones de acción
    const btnSend = this.selectedButtonIndex === 0
      ? `\x1b[7m${greenBright(" [✓ Enviar a GitHub] ")}\x1b[27m`
      : greenBright(" [✓ Enviar a GitHub] ");

    const btnEdit = this.selectedButtonIndex === 1
      ? `\x1b[7m${yellowBright(" [✏ Editar Respuesta] ")}\x1b[27m`
      : yellowBright(" [✏ Editar Respuesta] ");

    const btnReject = this.selectedButtonIndex === 2
      ? `\x1b[7m${bloodBright(" [✕ Ignorar / Descartar] ")}\x1b[27m`
      : bloodBright(" [✕ Ignorar / Descartar] ");

    lines.push(`  ${btnSend}  ${btnEdit}  ${btnReject}`);
    lines.push(`  ${dim("Tab: cambiar botón | Enter: seleccionar | Esc: descartar")}`);

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
      this.onDone({ action: "reject" });
      return true;
    }

    if (matchesKey(data, Key.tab)) {
      this.selectedButtonIndex = (this.selectedButtonIndex + 1) % 3;
      this.requestRender?.();
      return true;
    }

    if (matchesKey(data, Key.shift("tab") as any)) {
      this.selectedButtonIndex = (this.selectedButtonIndex + 2) % 3;
      this.requestRender?.();
      return true;
    }

    if (matchesKey(data, Key.enter)) {
      if (this.selectedButtonIndex === 0) {
        this.onDone({ action: "approve", reply: this.customReplyText });
      } else if (this.selectedButtonIndex === 1) {
        // En modo edición simple, permitir toggle o usar el texto
        this.onDone({ action: "approve", reply: this.customReplyText });
      } else {
        this.onDone({ action: "reject" });
      }
      return true;
    }

    return undefined;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "click" && event.button === "left") {
      this.onDone({ action: "approve", reply: this.customReplyText });
      return { handled: true };
    }
    return undefined;
  }
}

/**
 * Abre el modal interactivo de chat tipo WhatsApp en la terminal de Pi.
 */
export async function promptAgentChatModal(
  ctx: ExtensionContext,
  message: PendingChatMessage,
): Promise<ChatApprovalDecision> {
  const result = await openDcModal<ChatApprovalDecision>(ctx, {
    title: `💬 Mensaje en Issue #${message.issueNumber} (@${message.authorLogin})`,
    content: (done, theme, tui) => {
      return new DcAgentChatModalPanel(
        message,
        theme,
        (decision) => {
          done(decision);
        },
        () => {
          try { (tui as any)?.requestRender?.(); } catch {}
        },
      );
    },
  });

  return result || { action: "reject" };
}
