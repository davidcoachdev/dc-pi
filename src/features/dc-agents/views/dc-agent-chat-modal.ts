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
 * y permite al Owner editar la respuesta en vivo con teclado/mouse antes de enviarla a GitHub.
 */
export class DcAgentChatModalPanel implements Component {
  private customReplyText: string;
  private isEditing = false;
  private selectedButtonIndex = 0; // 0: Enviar, 1: Editar, 2: Ignorar
  private buttonsY = -1;
  private btnRanges: Array<{ start: number; end: number }> = [];

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

    // Burbuja derecha (Respuesta propuesta por el Super-Agente o modo edición)
    if (this.isEditing) {
      lines.push(`  ${yellowBright(bold("✏ EDITANDO RESPUESTA"))} ${dim("(Escribe tu opinión o ajusta el texto, pulsa Enter para guardar)")}:`);
      const editLines = this.wrapText(this.customReplyText, innerW - 6);
      for (let i = 0; i < editLines.length; i++) {
        const isLast = i === editLines.length - 1;
        lines.push(`    ${yellowBright("┃")} ${editLines[i]}${isLast ? "\x1b[7m \x1b[27m" : ""}`);
      }
    } else {
      lines.push(`  ${greenBright("🤖 Super-Agent 86")} ${dim("(borrador de respuesta)")}:`);
      const outLines = this.wrapText(this.customReplyText, innerW - 4);
      for (const l of outLines) {
        lines.push(`    ${greenBright("┃")} ${l}`);
      }
    }
    lines.push("");
    lines.push(`  ${dim("─".repeat(innerW))}`);

    // Fila de Botones de acción
    this.buttonsY = lines.length;
    this.btnRanges = [];

    const sendLabel = " [✓ Enviar a GitHub] ";
    const editLabel = this.isEditing ? " [✓ Listo / Guardar] " : " [✏ Editar Respuesta] ";
    const rejectLabel = " [✕ Ignorar / Descartar] ";

    const btnSend = this.selectedButtonIndex === 0
      ? `\x1b[7m${greenBright(sendLabel)}\x1b[27m`
      : greenBright(sendLabel);

    const btnEdit = this.selectedButtonIndex === 1
      ? `\x1b[7m${yellowBright(editLabel)}\x1b[27m`
      : yellowBright(editLabel);

    const btnReject = this.selectedButtonIndex === 2
      ? `\x1b[7m${bloodBright(rejectLabel)}\x1b[27m`
      : bloodBright(rejectLabel);

    let currentX = 2;
    this.btnRanges.push({ start: currentX, end: currentX + visibleWidth(sendLabel) });
    currentX += visibleWidth(sendLabel) + 2;

    this.btnRanges.push({ start: currentX, end: currentX + visibleWidth(editLabel) });
    currentX += visibleWidth(editLabel) + 2;

    this.btnRanges.push({ start: currentX, end: currentX + visibleWidth(rejectLabel) });

    lines.push(`  ${btnSend}  ${btnEdit}  ${btnReject}`);

    if (this.isEditing) {
      lines.push(`  ${dim("Teclas: Escribe para agregar texto | Backspace: borrar | Enter: terminar edición")}`);
    } else {
      lines.push(`  ${dim("Teclas: Tab / Shift+Tab: cambiar botón | Enter: confirmar botón | Esc: descartar")}`);
    }

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
    if (this.isEditing) {
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
        this.isEditing = false;
        this.selectedButtonIndex = 0; // Al terminar de editar, volver al botón Enviar
        this.requestRender?.();
        return true;
      }
      if (matchesKey(data, Key.backspace)) {
        if (this.customReplyText.length > 0) {
          this.customReplyText = this.customReplyText.slice(0, -1);
          this.requestRender?.();
        }
        return true;
      }
      // Caracteres imprimibles
      if (data.length === 1 && data.charCodeAt(0) >= 32) {
        this.customReplyText += data;
        this.requestRender?.();
        return true;
      }
      return undefined;
    }

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
        this.isEditing = true;
        this.requestRender?.();
      } else {
        this.onDone({ action: "reject" });
      }
      return true;
    }

    return undefined;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "click" && event.button === "left" && event.y !== undefined && event.x !== undefined) {
      // Verificar si el clic fue en la línea de los botones
      if (event.y === this.buttonsY) {
        const x = event.x;
        for (let i = 0; i < this.btnRanges.length; i++) {
          const r = this.btnRanges[i]!;
          if (x >= r.start && x <= r.end) {
            this.selectedButtonIndex = i;
            if (i === 0) {
              this.onDone({ action: "approve", reply: this.customReplyText });
            } else if (i === 1) {
              this.isEditing = !this.isEditing;
              this.requestRender?.();
            } else if (i === 2) {
              this.onDone({ action: "reject" });
            }
            return { handled: true };
          }
        }
      }
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
