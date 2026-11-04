import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key, matchesKey, truncateToWidth, visibleWidth,
  type Component, type TUI, type TuiMouseEvent, type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { openDcModal } from "../../../ui/dc-modal.ts";
import type { AgentQuestionPacket, AgentAnswerPacket } from "../daemon/dc-remote-question.ts";
import { dcRemoteQuestionManager } from "../daemon/dc-remote-question.ts";

export class DcAgentQuestionPanel implements Component {
  private selectedOptionIndex = 0;
  private isEditingCustomText = false;
  private customText = "";
  private cursorPos = 0;

  constructor(
    private readonly packet: AgentQuestionPacket,
    private readonly theme: Theme,
    private readonly onDone: (answer?: AgentAnswerPacket) => void,
    private readonly requestRender?: () => void,
    private readonly questionManager = dcRemoteQuestionManager,
  ) {}

  invalidate(): void {}

  private submitOption(idx: number): void {
    const opts = this.packet.options || [];
    const chosen = opts[idx] || opts[0] || "Continuar";
    const answer: AgentAnswerPacket = {
      questionId: this.packet.id,
      chosenOption: chosen,
      answeredAt: Date.now(),
      source: "option",
    };
    this.questionManager.postAnswer(answer);
    this.onDone(answer);
  }

  private submitCustomText(): void {
    const text = this.customText.trim();
    if (!text) {
      this.submitOption(this.selectedOptionIndex);
      return;
    }

    const answer: AgentAnswerPacket = {
      questionId: this.packet.id,
      customText: text,
      answeredAt: Date.now(),
      source: "custom_text",
    };
    this.questionManager.postAnswer(answer);
    this.onDone(answer);
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, Key.escape)) {
      const dismiss: AgentAnswerPacket = {
        questionId: this.packet.id,
        answeredAt: Date.now(),
        source: "dismissed",
      };
      this.questionManager.postAnswer(dismiss);
      this.onDone(dismiss);
      return true;
    }

    // Si está en modo de edición de texto libre:
    if (this.isEditingCustomText) {
      if (matchesKey(data, Key.enter) || data === "enter" || data === "\r" || data === "\n") {
        this.submitCustomText();
        return true;
      }

      if (matchesKey(data, Key.tab)) {
        this.isEditingCustomText = false;
        this.requestRender?.();
        return true;
      }

      if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
        if (this.cursorPos > 0) {
          this.customText = this.customText.slice(0, this.cursorPos - 1) + this.customText.slice(this.cursorPos);
          this.cursorPos--;
          this.requestRender?.();
        }
        return true;
      }

      if (matchesKey(data, Key.left)) {
        this.cursorPos = Math.max(0, this.cursorPos - 1);
        this.requestRender?.();
        return true;
      }

      if (matchesKey(data, Key.right)) {
        this.cursorPos = Math.min(this.customText.length, this.cursorPos + 1);
        this.requestRender?.();
        return true;
      }

      // Caracteres imprimibles ordinarios
      if (data.length === 1 && data >= " " && data <= "~") {
        this.customText = this.customText.slice(0, this.cursorPos) + data + this.customText.slice(this.cursorPos);
        this.cursorPos++;
        this.requestRender?.();
        return true;
      }

      return false;
    }

    // Modo selección de opciones rápidas:
    const optsCount = this.packet.options?.length || 0;

    // Atajos numéricos 1..N
    const num = parseInt(data, 10);
    if (!isNaN(num) && num >= 1 && num <= optsCount) {
      this.submitOption(num - 1);
      return true;
    }

    if (matchesKey(data, Key.tab)) {
      if (this.packet.allowCustomText !== false) {
        this.isEditingCustomText = true;
        this.requestRender?.();
        return true;
      }
    }

    if (matchesKey(data, Key.up) || matchesKey(data, Key.left)) {
      this.selectedOptionIndex = (this.selectedOptionIndex - 1 + optsCount) % optsCount;
      this.requestRender?.();
      return true;
    }

    if (matchesKey(data, Key.down) || matchesKey(data, Key.right)) {
      this.selectedOptionIndex = (this.selectedOptionIndex + 1) % optsCount;
      this.requestRender?.();
      return true;
    }

    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      this.submitOption(this.selectedOptionIndex);
      return true;
    }

    // Si presiona cualquier tecla alfanumérica, salta a edición de texto libre
    if (this.packet.allowCustomText !== false && data.length === 1 && data >= " " && data <= "~") {
      this.isEditingCustomText = true;
      this.customText += data;
      this.cursorPos = this.customText.length;
      this.requestRender?.();
      return true;
    }

    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "click" && event.button === "left") {
      // Clic en input de texto libre
      if (event.y >= 14 && event.y <= 16) {
        this.isEditingCustomText = true;
        this.requestRender?.();
        return { handled: true, render: true };
      }
    }
    return undefined;
  }

  render(width: number): string[] {
    const t = this.theme;
    const lines: string[] = [];
    const innerW = Math.max(50, width);

    // Cabecera
    lines.push(t.bold(t.fg("accent", `⛩  DC Super-Agent te consulta: Issue #${this.packet.issueNumber}`)));
    lines.push(t.fg("border", "─".repeat(innerW)));

    // 1. Sección Contexto
    lines.push(t.bold(t.fg("warning", "📌 CONTEXTO DE LO QUE ESTÁ HACIENDO EL AGENTE:")));
    const ctxLines = this.packet.contextSummary.split("\n");
    for (const cl of ctxLines) {
      lines.push(`  ${t.fg("dim", cl)}`);
    }
    lines.push("");

    // 2. Sección Pregunta
    lines.push(t.bold(t.fg("accent", "❓ PREGUNTA CONCRETA:")));
    lines.push(`  ${t.bold(this.packet.question)}`);
    lines.push("");

    // 3. Sección Opciones Rápidas
    lines.push(t.bold("💡 OPCIONES RÁPIDAS:"));
    const opts = this.packet.options || ["Continuar", "Cancelar"];
    opts.forEach((opt, idx) => {
      const isSel = idx === this.selectedOptionIndex && !this.isEditingCustomText;
      const prefix = isSel ? t.bold(t.fg("accent", `▶ [${idx + 1}] `)) : `  [${idx + 1}] `;
      const text = isSel ? t.bold(t.fg("accent", opt)) : opt;
      lines.push(`${prefix}${text}`);
    });
    lines.push("");

    // 4. Sección Texto Libre
    if (this.packet.allowCustomText !== false) {
      const editBadge = this.isEditingCustomText
        ? t.bold(t.fg("accent", "[ESCRIBIENDO...]"))
        : t.fg("dim", "(Presiona Tab o escribe para ingresar indicación propia)");
      lines.push(`${t.bold("✍️ O ESCRIBE TU PROPIA INDICACIÓN:")} ${editBadge}`);

      const boxW = Math.max(20, innerW - 4);
      const cursorChar = this.isEditingCustomText ? "█" : "";
      const textBefore = this.customText.slice(0, this.cursorPos);
      const textAfter = this.customText.slice(this.cursorPos);
      const renderedInput = `> ${textBefore}${cursorChar}${textAfter}`;

      const borderStyle = this.isEditingCustomText ? "accent" : "border";
      lines.push(`  ${t.fg(borderStyle as any, "┌" + "─".repeat(boxW) + "┐")}`);
      lines.push(`  ${t.fg(borderStyle as any, "│")} ${truncateToWidth(renderedInput, boxW - 2, "")} ${t.fg(borderStyle as any, "│")}`);
      lines.push(`  ${t.fg(borderStyle as any, "└" + "─".repeat(boxW) + "┘")}`);
    }

    return lines.map((l) => truncateToWidth(l, innerW, ""));
  }
}

/**
 * Abre la ventana modal interactiva para responder una consulta remota del superagente.
 */
export async function promptAgentQuestionModal(
  ctx: ExtensionContext,
  packet: AgentQuestionPacket,
): Promise<AgentAnswerPacket | undefined> {
  let panelRef: DcAgentQuestionPanel | undefined;

  const res = await openDcModal<AgentAnswerPacket>(ctx, {
    title: `Consulta de Super-Agente — Issue #${packet.issueNumber}`,
    glyph: "⛩ ",
    frame: "double",
    width: 82,
    maxHeight: 22,
    footer: (theme) => ({
      left: ` [1..N] Opción   [Tab] Escribir texto libre   [Enter] Enviar`,
      right: `[Esc Descartar] `,
    }),
    content: (done, theme, tui) => {
      panelRef = new DcAgentQuestionPanel(
        packet,
        theme,
        (answer) => done(answer),
        () => tui.requestRender(),
      );
      return panelRef;
    },
  });

  return res;
}
