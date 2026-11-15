/**
 * dc-takeover-modal.ts — Interactive DOS/Retro modal for Human Takeover requests.
 *
 * Renders a DcWindow panel where the user decides whether the agent continues,
 * retries the previous step, or aborts the task (CAPTCHAs, 2FA, biometrics,
 * physical validation on mobile devices).
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key, matchesKey, visibleWidth,
  type Component, type TUI, type TuiMouseEvent, type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { openDcModal } from "../../../ui/dc-modal.ts";
import type { TakeoverOutcome, TakeoverRequest } from "../core/dc-takeover-types.ts";

interface TakeoverButton {
  outcome: TakeoverOutcome;
  label: string;
}

const BUTTONS: readonly TakeoverButton[] = [
  { outcome: "continued", label: "Continuar" },
  { outcome: "retry", label: "Reintentar" },
  { outcome: "aborted", label: "Abortar" },
];

interface ButtonHitbox {
  idx: number;
  outcome: TakeoverOutcome;
  startX: number;
  endX: number;
  y: number;
}

function wrapText(
  label: string,
  text: string,
  maxWidth: number,
  theme: Theme,
  bodyColor: string = "text",
  labelColor: string = "accent",
): string[] {
  const prefix = theme.bold(theme.fg(labelColor as any, label)) + " ";
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
    const formatted = theme.fg(bodyColor as any, line);
    return i === 0 ? prefix + formatted : indent + formatted;
  });
}

export class DcTakeoverPanel implements Component {
  private selectedIndex = 0;
  private buttonHitboxes: ButtonHitbox[] = [];

  constructor(
    private readonly request: TakeoverRequest,
    private readonly theme: Theme,
    private readonly done: (outcome: TakeoverOutcome) => void,
    private readonly requestRender?: () => void,
  ) {}

  invalidate(): void {}

  private confirmSelection(): void {
    const outcome = BUTTONS[this.selectedIndex]?.outcome ?? "aborted";
    this.done(outcome);
  }

  private moveSelection(delta: number): void {
    this.selectedIndex = (this.selectedIndex + delta + BUTTONS.length) % BUTTONS.length;
    this.requestRender?.();
  }

  handleInput(key: string): boolean {
    const isShiftTab = key === "shift+tab" || key === "\x1b[Z" ||
      matchesKey(key, "shift+tab");

    if (matchesKey(key, Key.left) || key === "left") {
      this.moveSelection(-1);
      return true;
    }
    if (matchesKey(key, Key.right) || key === "right") {
      this.moveSelection(1);
      return true;
    }
    if (isShiftTab) {
      this.moveSelection(-1);
      return true;
    }
    if (matchesKey(key, Key.tab) || key === "tab") {
      this.moveSelection(1);
      return true;
    }
    if (matchesKey(key, Key.enter) || matchesKey(key, Key.space) || key === "enter" || key === "space") {
      this.confirmSelection();
      return true;
    }
    if (matchesKey(key, Key.escape) || key === "escape") {
      this.done("aborted");
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
    lines.push(this.theme.bold(this.theme.fg("warning", `⚠ ${this.request.title}`)));
    lines.push(this.theme.fg("muted", "─".repeat(Math.max(10, width - 4))));
    lines.push("");

    lines.push(...wrapText("Motivo:", this.request.reason, width, this.theme, "text"));
    lines.push("");
    lines.push(...wrapText(
      "Acción sugerida:",
      this.request.suggestedAction,
      width,
      this.theme,
      "warning",
      "accent",
    ));
    lines.push("");

    const buttonRowY = lines.length;
    this.buttonHitboxes = [];
    let currentX = 0;

    const renderedButtons = BUTTONS.map((button, idx) => {
      const isSelected = idx === this.selectedIndex;
      const text = isSelected ? `[▶ ${button.label} ◀]` : `[ ${button.label} ]`;
      const buttonWidth = visibleWidth(text);
      this.buttonHitboxes.push({
        idx,
        outcome: button.outcome,
        startX: currentX,
        endX: currentX + buttonWidth,
        y: buttonRowY,
      });
      currentX += buttonWidth + 1;
      if (isSelected) {
        return this.theme.bold(this.theme.fg("accent", text));
      }
      return this.theme.fg("muted", text);
    }).join(" ");

    lines.push(renderedButtons);
    return lines;
  }
}

/**
 * Opens the Human Takeover modal and resolves with the user's decision.
 */
export async function openDcTakeoverModal(
  ctx: ExtensionContext,
  request: TakeoverRequest,
): Promise<TakeoverOutcome> {
  const result = await openDcModal<TakeoverOutcome>(ctx, {
    title: "🎮 Intervención Humana Requerida",
    glyph: "🎮 ",
    width: 68,
    frame: "double",
    content: (done: (value?: TakeoverOutcome) => void, theme: Theme, tui: TUI) => {
      return new DcTakeoverPanel(
        request,
        theme,
        (outcome) => done(outcome),
        () => tui?.requestRender?.(),
      );
    },
    footer: {
      left: " [←/→] Seleccionar   [Tab] Siguiente   [Enter] Confirmar",
      right: "[Esc] Abortar ",
    },
    onNonTui: () => "aborted",
  });

  return result ?? "aborted";
}
