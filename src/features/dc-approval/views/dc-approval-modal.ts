/**
 * dc-approval-modal.ts — Modal interactivo DOS/Retro con DcWindow para elevación de permisos unitaria.
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { openDcModal } from "../../../ui/dc-modal.ts";
import type { ApprovalOutcome, ApprovalRequest } from "../core/dc-approval-types.ts";
import { dcApprovalCoordinator } from "../core/dc-approval-coordinator.ts";

export class DcApprovalPanel implements Component {
  private selectedIndex = 0; // 0: Aceptar una sola vez, 1: Rechazar, 2: Cancelar turno
  private readonly options: readonly ApprovalOutcome[] = ["allowed-once", "rejected", "cancelled"];

  constructor(
    private readonly request: ApprovalRequest,
    private readonly theme: Theme,
    private readonly done: (outcome: ApprovalOutcome) => void,
    private readonly requestRender?: () => void,
  ) {}

  invalidate(): void {}

  handleInput(key: string): boolean {
    if (key === "left" || key === "up") {
      this.selectedIndex = (this.selectedIndex - 1 + this.options.length) % this.options.length;
      this.requestRender?.();
      return true;
    }
    if (key === "right" || key === "down" || key === "tab") {
      this.selectedIndex = (this.selectedIndex + 1) % this.options.length;
      this.requestRender?.();
      return true;
    }
    if (key === "enter" || key === "space") {
      const outcome = this.options[this.selectedIndex] ?? "rejected";
      if (outcome === "allowed-once") {
        dcApprovalCoordinator.grantOnce(this.request.id);
      }
      this.done(outcome);
      return true;
    }
    if (key === "escape") {
      this.done("cancelled");
      return true;
    }
    return false;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    lines.push(this.theme.bold("⚠️ SOLICITUD DE ELEVACIÓN DE PRIVILEGIOS"));
    lines.push(this.theme.fg("muted", "─".repeat(Math.max(10, width - 4))));

    lines.push(`${this.theme.bold("Herramienta:")}  ${this.theme.fg("accent", this.request.toolName)}`);
    lines.push(`${this.theme.bold("Acción:")}       ${this.request.action}`);
    if (this.request.target) {
      lines.push(`${this.theme.bold("Objetivo:")}     ${this.theme.fg("warning", this.request.target)}`);
    }
    lines.push(`${this.theme.bold("Motivo:")}       ${this.theme.fg("muted", this.request.reason)}`);
    lines.push("");

    const buttons = [
      { label: " [1] Aceptar una sola vez ", outcome: "allowed-once" as const },
      { label: " [2] Rechazar ", outcome: "rejected" as const },
      { label: " [3] Cancelar ", outcome: "cancelled" as const },
    ];

    const renderedButtons = buttons.map((btn, idx) => {
      const isSelected = idx === this.selectedIndex;
      if (isSelected) {
        return this.theme.bold(this.theme.fg("accent", `▶ ${btn.label}`));
      }
      return this.theme.fg("muted", `  ${btn.label}`);
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
    footer: "← / → : Seleccionar   ·   Enter : Confirmar   ·   Esc : Cancelar",
    onNonTui: () => "rejected", // Fail-closed en modo headless sin terminal interactiva
  });

  return result ?? "cancelled";
}
