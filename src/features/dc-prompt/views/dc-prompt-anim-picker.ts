import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openDcModal } from "../../../ui/dc-modal.ts";
import { listPromptAnimations, type PromptAnimation } from "../animations/index.ts";
import { readPromptPrefs, writePromptPrefs } from "../core/dc-prompt-prefs.ts";
import { dcNotifier } from "../../../integrations/dc-notify/dc-notifier.ts";
import { getCurrentEditor } from "../dc-prompt.ts";

export interface PromptAnimTheme {
  fg: (role: string, text: string) => string;
  bold: (text: string) => string;
}

/**
 * Panel interactivo para seleccionar la animación del prompt de entrada (KITT, Pacman, etc.).
 * Muestra la lista de animaciones con su nombre, selector de radio button (◉ / ○)
 * y al lado la animación en vivo corriendo cuadro por cuadro.
 */
export class PromptAnimPickerPanel implements Component {
  public selectedIndex = 0;
  public animations: PromptAnimation[];
  public onPick?: (name: string) => void;
  public onCancel?: () => void;
  private tick = 0;
  private timer: NodeJS.Timeout | null = null;
  private requestRenderCb?: () => void;

  constructor(
    private theme: PromptAnimTheme,
    currentAnimation = "kitt",
  ) {
    this.animations = listPromptAnimations();
    const idx = this.animations.findIndex(
      (a) => a.name.toLowerCase() === currentAnimation.toLowerCase(),
    );
    this.selectedIndex = idx >= 0 ? idx : 0;
  }

  start(requestRender: () => void): void {
    this.requestRenderCb = requestRender;
    this.stop();
    // 120ms para refrescar el tick de las animaciones en el preview
    this.timer = setInterval(() => {
      this.tick = (this.tick + 1) % 10000;
      this.requestRenderCb?.();
    }, 120);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const fg = this.theme.fg;
    const lines: string[] = [""];

    const colNameW = 20;

    for (let i = 0; i < this.animations.length; i++) {
      const anim = this.animations[i]!;
      const isSelected = i === this.selectedIndex;

      // 1. Selector de radio button y nombre
      const bullet = isSelected ? "◉" : "○";
      const rawLabel = ` ${bullet}  ${anim.name.toUpperCase()}`;
      const styledLabel = isSelected
        ? fg("accent", this.theme.bold(rawLabel))
        : fg("dim", rawLabel);

      const paddedLabel =
        styledLabel +
        " ".repeat(Math.max(0, colNameW - visibleWidth(rawLabel)));

      // 2. Línea divisoria vertical
      const div = fg("accent", "│");

      // 3. Preview en vivo de la animación al lado
      // En la animación seleccionada corre con su tick; las inactivas pueden correr o mostrar frame estático
      const animPreview = anim.render(this.tick);
      const previewBox = `  [ ${animPreview} ]`;

      const row = `${paddedLabel} ${div} ${previewBox}`;
      lines.push(truncateToWidth(row, width, ""));
      lines.push(""); // Espacio entre items
    }

    return lines;
  }

  handleInput(data: string): void {
    const total = this.animations.length;
    if (total === 0) return;

    if (matchesKey(data, Key.up) || matchesKey(data, Key.left)) {
      this.selectedIndex = (this.selectedIndex - 1 + total) % total;
    } else if (
      matchesKey(data, Key.down) ||
      matchesKey(data, Key.right) ||
      matchesKey(data, Key.tab)
    ) {
      this.selectedIndex = (this.selectedIndex + 1) % total;
    } else if (matchesKey(data, Key.enter)) {
      const chosen = this.animations[this.selectedIndex]?.name ?? "kitt";
      this.stop();
      this.onPick?.(chosen);
    } else if (matchesKey(data, Key.escape)) {
      this.stop();
      this.onCancel?.();
    }
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel") return undefined;
    if (event.button !== "left" || (event.type !== "press" && event.type !== "click")) {
      return undefined;
    }

    // Cada item ocupa 2 líneas (línea de contenido + línea en blanco de separación)
    // Empezando en y=1
    const clickedIdx = Math.floor((event.y - 1) / 2);
    if (clickedIdx >= 0 && clickedIdx < this.animations.length) {
      this.selectedIndex = clickedIdx;
      if (event.type === "click") {
        const chosen = this.animations[this.selectedIndex]?.name ?? "kitt";
        this.stop();
        this.onPick?.(chosen);
      }
      return { handled: true };
    }

    return undefined;
  }
}

/**
 * Abre el selector modal de animaciones de prompt montado sobre openDcModal y DcWindow.
 */
export async function openPromptAnimPicker(ctx: ExtensionContext): Promise<string | undefined> {
  const current = readPromptPrefs().animation;
  let activePanel: PromptAnimPickerPanel | undefined;

  return openDcModal<string>(ctx, {
    title: "⛩  Dc Studio - Animación de Prompt",
    glyph: "⚡",
    width: 58,
    maxHeight: 18,
    scrollable: false,
    showScrollbar: false,
    footer: (theme) => ({
      left: ` ${theme.fg("accent", "↑↓")} ${theme.fg("muted", "elegir")}  ·  ${theme.fg("accent", "Enter")} ${theme.fg("muted", "usar")}  ·  ${theme.fg("accent", "Esc")} ${theme.fg("muted", "cerrar")}`,
      right: theme.fg("accent", "[ Usar ]"),
    }),
    onFooterRightClick: () => {
      if (activePanel) {
        const chosen =
          activePanel.animations[activePanel.selectedIndex]?.name ?? "kitt";
        activePanel.stop();
        activePanel.onPick?.(chosen);
      }
    },
    content: (done, _theme, tui) => {
      const theme: PromptAnimTheme = {
        fg: (role, text) => {
          if (role === "accent") return `\x1b[38;2;255;77;77m${text}\x1b[0m`;
          if (role === "dim" || role === "muted") return `\x1b[2m${text}\x1b[22m`;
          return text;
        },
        bold: (text) => `\x1b[1m${text}\x1b[22m`,
      };

      const panel = new PromptAnimPickerPanel(theme, current);
      activePanel = panel;
      panel.start(() => tui.requestRender());

      panel.onPick = (chosen) => {
        writePromptPrefs({ animation: chosen });
        getCurrentEditor()?.refresh();
        dcNotifier.notify(
          ctx,
          "DC Prompt",
          `Animación cambiada a: ${chosen.toUpperCase()}`,
          "info",
        );
        done(chosen);
      };

      panel.onCancel = () => {
        panel.stop();
        done(undefined);
      };

      return panel;
    },
  });
}
