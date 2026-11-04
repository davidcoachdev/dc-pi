/**
 * dc-approval-modal.ts — Modal interactivo DOS/Retro con DcWindow para elevación de permisos unitaria.
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key, matchesKey, visibleWidth,
  type Component, type TUI, type TuiMouseEvent, type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { openDcModal } from "../../../ui/dc-modal.ts";
import type { ApprovalOutcome, ApprovalRequest } from "../core/dc-approval-types.ts";
import { dcApprovalCoordinator } from "../core/dc-approval-coordinator.ts";

interface ButtonHitbox {
  idx: number;
  outcome: ApprovalOutcome;
  startX: number;
  endX: number;
  y: number;
}

function wrapText(label: string, text: string, maxWidth: number, theme: Theme, colorRole: string = "text"): string[] {
  const prefix = theme.bold(label) + " ";
  const prefixWidth = visibleWidth(label) + 1;
  const contentWidth = Math.max(10, maxWidth - prefixWidth);
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (visibleWidth(current ? current + " " + word : word) <= contentWidth) {
      current = current ? current + " " + word : word;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length === 0) lines.push("");

  const indent = " ".repeat(prefixWidth);
  return lines.map((line, i) => {
    const formatted = theme.fg(colorRole as any, line);
    return i === 0 ? prefix + formatted : indent + formatted;
  });
}

export class DcApprovalPanel implements Component {
  private selectedIndex = 0; // 0: Aceptar una sola vez, 1: Rechazar, 2: Cancelar turno
  private readonly options: readonly ApprovalOutcome[] = ["allowed-once", "rejected", "cancelled"];
  private buttonHitboxes: ButtonHitbox[] = [];

  constructor(
    private readonly request: ApprovalRequest,
    private readonly theme: Theme,
    private readonly done: (outcome: ApprovalOutcome) => void,
    private readonly requestRender?: () => void,
  ) {}

  invalidate(): void {}

  private confirmSelection(): void {
    const outcome = this.options[this.selectedIndex] ?? "rejected";
    if (outcome === "allowed-once") {
      dcApprovalCoordinator.grantOnce(this.request.id);
    }
    this.done(outcome);
  }

  handleInput(key: string): boolean {
    if (matchesKey(key, Key.left) || matchesKey(key, Key.up) || key === "left" || key === "up") {
      this.selectedIndex = (this.selectedIndex - 1 + this.options.length) % this.options.length;
      this.requestRender?.();
      return true;
    }
    if (matchesKey(key, Key.right) || matchesKey(key, Key.down) || matchesKey(key, Key.tab) || key === "right" || key === "down" || key === "tab") {
      this.selectedIndex = (this.selectedIndex + 1) % this.options.length;
      this.requestRender?.();
      return true;
    }
    if (key === "1") {
      this.selectedIndex = 0;
      this.confirmSelection();
      return true;
    }
    if (key === "2") {
      this.selectedIndex = 1;
      this.confirmSelection();
      return true;
    }
    if (key === "3") {
      this.selectedIndex = 2;
      this.confirmSelection();
      return true;
    }
    if (matchesKey(key, Key.enter) || matchesKey(key, Key.space) || key === "enter" || key === "space") {
      this.confirmSelection();
      return true;
    }
    if (matchesKey(key, Key.escape) || key === "escape") {
      this.done("cancelled");
      return true;
    }
    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "click" && event.button === "left") {
      for (const box of this.buttonHitboxes) {
        if (event.y === box.y && event.x >= box.startX && event.x < box.endX) {
          this.selectedIndex = box.idx;
          this.confirmSelection();
          return { handled: true, render: true };
        }
      }
    }
    return undefined;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    lines.push(this.theme.bold("⚠️ SOLICITUD DE ELEVACIÓN DE PRIVILEGIOS"));
    lines.push(this.theme.fg("muted", "─".repeat(Math.max(10, width - 4))));

    lines.push(`${this.theme.bold("Herramienta:")}  ${this.theme.fg("accent", this.request.toolName)}`);
    lines.push(...wrapText("Acción:", this.request.action, width, this.theme, "text"));
    if (this.request.target) {
      lines.push(...wrapText("Objetivo:", this.request.target, width, this.theme, "warning"));
    }
    lines.push(...wrapText("Motivo:", this.request.reason, width, this.theme, "muted"));
    lines.push("");

    const buttons = [
      { label: "[1] Aceptar una sola vez", outcome: "allowed-once" as const },
      { label: "[2] Rechazar", outcome: "rejected" as const },
      { label: "[3] Cancelar", outcome: "cancelled" as const },
    ];

    const buttonRowY = lines.length;
    this.buttonHitboxes = [];
    let currentX = 0;

    const renderedButtons = buttons.map((btn, idx) => {
      const isSelected = idx === this.selectedIndex;
      const prefix = isSelected ? "▶ " : "  ";
      const fullText = `${prefix}${btn.label} `;
      const btnWidth = visibleWidth(fullText);
      this.buttonHitboxes.push({
        idx,
        outcome: btn.outcome,
        startX: currentX,
        endX: currentX + btnWidth,
        y: buttonRowY,
      });
      currentX += btnWidth + 1;
      if (isSelected) {
        return this.theme.bold(this.theme.fg("accent", fullText));
      }
      return this.theme.fg("muted", fullText);
    }).join(" ");

    lines.push(renderedButtons);
    return lines;
  }
}

/**
 * Abre el diálogo modal de confirmación interactiva.
 */
export async function promptApprovalModal(
  ctx: ExtensionContext | undefined,
  request: ApprovalRequest,
): Promise<ApprovalOutcome> {
  const result = await openDcModal<ApprovalOutcome>(ctx, {
    title: "Seguridad DC Studio — Permiso Unitario",
    glyph: "🛡️ ",
    width: 68,
    frame: "double",
    content: (done: (value?: ApprovalOutcome) => void, theme: Theme, tui: TUI) => {
      return new DcApprovalPanel(
        request,
        theme,
        (val) => done(val),
        () => tui?.requestRender?.(),
      );
    },
    footer: {
      left: " [←/→] Seleccionar   [Enter] Confirmar   [1-3] Atajo rápido",
      right: "[Esc] Cancelar ",
    },
    onNonTui: () => "rejected", // Fail-closed en modo headless sin terminal interactiva
  });

  return result ?? "cancelled";
}
