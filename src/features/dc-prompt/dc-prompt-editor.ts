/**
 * dc-prompt-editor — Editor de entrada personalizado con marco estilo DOS (╔═ ⛩ ═╗).
 */

import {
  CustomEditor,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import { getUserName } from "../dc-user/dc-user-store.ts";
import {
  cell,
  DC_PROMPT,
  FAKE_CURSOR,
  FRAMES,
} from "./dc-prompt-tokens.ts";
import { getPromptAnimation } from "./animations/index.ts";
import { readPromptPrefs } from "./core/dc-prompt-prefs.ts";

export interface DcPromptDeps {
  fg: (color: string, text: string) => string;
  bold: (text: string) => string;
  /** Color de todo el marco (permite derivarlo del effort del modelo). */
  borderColor: (text: string) => string;
  requestRender(): void;
  statusLine?: (width: number) => string;
}

export class DcPromptEditor extends CustomEditor {
  private working = false;
  private queued = false;
  private tick = 0;
  private pulse?: NodeJS.Timeout;
  private readonly deps: DcPromptDeps;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    deps: DcPromptDeps,
  ) {
    super(tui, theme, keybindings);
    this.deps = deps;
  }

  setWorking(working: boolean, queued = false): void {
    this.working = working;
    this.queued = queued;
    this.stopPulse();
    if (working) {
      this.pulse = setInterval(() => {
        this.tick += 1;
        this.deps.requestRender();
      }, DC_PROMPT.pulseMs);
      this.pulse.unref?.();
    }
    this.deps.requestRender();
  }

  setQueued(queued: boolean): void {
    if (this.queued !== queued) {
      this.queued = queued;
      this.refresh();
    }
  }

  dispose(): void {
    this.stopPulse();
  }

  private stopPulse(): void {
    if (this.pulse) clearInterval(this.pulse);
    this.pulse = undefined;
    this.tick = 0;
  }

  refresh(): void {
    this.deps.requestRender();
  }

  isWorking(): boolean {
    return this.working;
  }

  isQueued(): boolean {
    return this.queued;
  }

  /**
   * Renderiza el barrido de animación activo configurado (ej: kitt).
   */
  kitt(): string {
    const prefs = readPromptPrefs();
    const animation = getPromptAnimation(prefs.animation);
    return animation.render(this.tick);
  }

  glyph(): string {
    if (this.queued) return this.deps.fg(DC_PROMPT.glyphColor, DC_PROMPT.queuedGlyph);
    if (this.working) return this.kitt();
    return this.deps.fg(DC_PROMPT.glyphColor, DC_PROMPT.glyphIdle);
  }

  withHint(line: string): string {
    if (this.getText().length !== 0) return line;
    const at = line.indexOf(FAKE_CURSOR);
    if (at === -1) return line;
    const after = at + FAKE_CURSOR.length;
    const trailing = line.slice(after);
    if (trailing.trim() !== "") return line;
    const hint = DC_PROMPT.hint;
    if (trailing.length < hint.length + 1) return line;
    return (
      line.slice(0, after) +
      " " +
      this.deps.fg(DC_PROMPT.hintColor, hint) +
      " ".repeat(trailing.length - hint.length - 1)
    );
  }

  render(width: number): string[] {
    const inner = Math.max(1, width - 2);
    const raw = super.render(inner);
    if (raw.length < 2) return raw.map((l) => truncateToWidth(l, width, ""));

    const f = FRAMES[DC_PROMPT.frame];
    const b = (s: string) => this.deps.borderColor(s);
    const glyph = this.glyph();

    // Borde superior con el glifo a la izquierda (estilo DOS).
    // En IDLE (sin trabajar ni cola) le ponemos al lado el nombre del usuario.
    const nameText = !this.working && !this.queued ? getUserName().trim() : "";
    const name = nameText ? this.deps.fg("muted", nameText) + " " : "";
    const left = `${b(f.tl + f.h)} ${glyph}${" ".repeat(DC_PROMPT.glyphRightPad)}${name}`;
    const fill = Math.max(0, width - visibleWidth(left) - 1);
    const top = left + b(f.h.repeat(fill)) + b(f.tr);

    const body = raw
      .slice(1, -1)
      .map((l) => b(f.v) + cell(this.withHint(l), inner) + b(f.v));

    const bottom = b(f.bl + f.h.repeat(inner) + f.br);
    const resultLines = [top, ...body, bottom];

    // Status bar debajo del input prompt (estilo Gentle Shell / Screenshot, responsivo al ancho)
    if (typeof this.deps.statusLine === "function") {
      const status = this.deps.statusLine(width);
      if (status) {
        resultLines.push(status);
      }
    }

    return resultLines.map((l) =>
      visibleWidth(l) > width ? truncateToWidth(l, width, "") : l,
    );
  }
}
