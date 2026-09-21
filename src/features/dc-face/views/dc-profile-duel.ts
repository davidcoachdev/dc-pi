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
import { BIG_DEFAULT } from "../art/dcdev.ts";
import { CUBIS_DEFAULT } from "../art/cubis.ts";
import { paintBigLine } from "../art/painter.ts";
import { readFacePrefs, writeFacePrefs } from "../core/dc-face-prefs.ts";
import { dcNotifier } from "../../../integrations/dc-notify/dc-notifier.ts";

export interface DuelTheme {
  fg: (role: string, text: string) => string;
  bold: (text: string) => string;
}

export class ProfileDuel implements Component {
  public selected: 0 | 1;
  public onPick?: (profile: "dcdev" | "cubis") => void;
  public onCancel?: () => void;
  private lastColW: number = 24;
  private lastH: number = 12;

  constructor(
    private theme: DuelTheme,
    current: "dcdev" | "cubis" = "dcdev",
  ) {
    this.selected = current === "cubis" ? 1 : 0;
  }

  invalidate(): void {}

  private metrics(inner: number) {
    const colW = Math.max(22, Math.floor((inner - 3) / 2));
    const H = Math.max(BIG_DEFAULT.length, CUBIS_DEFAULT.length);
    return { colW, H };
  }

  private faceCell(lines: readonly string[], selected: boolean, colW: number, H: number): string[] {
    const fg = this.theme.fg;
    const w = Math.max(...lines.map((l) => visibleWidth(l)));
    const norm = lines.map((l) => l + " ".repeat(Math.max(0, w - visibleWidth(l))));
    const top = Math.floor((H - norm.length) / 2);
    const full: string[] = [
      ...Array<string>(Math.max(0, top)).fill(" ".repeat(w)),
      ...norm,
      ...Array<string>(Math.max(0, H - top - norm.length)).fill(" ".repeat(w)),
    ];
    return full.map((l) => {
      const painted = selected ? paintBigLine(l, fg) : fg("dim", l);
      const lp = Math.floor((colW - w) / 2);
      const rp = Math.max(0, colW - w - lp);
      return " ".repeat(Math.max(0, lp)) + painted + " ".repeat(rp);
    });
  }

  private label(text: string, selected: boolean, colW: number): string {
    const fg = this.theme.fg;
    const raw = `${selected ? "◉" : "○"} ${text}`;
    const styled = selected ? fg("accent", this.theme.bold(raw)) : fg("dim", raw);
    const lp = Math.floor((colW - visibleWidth(raw)) / 2);
    return " ".repeat(Math.max(0, lp)) + styled + " ".repeat(Math.max(0, colW - lp - visibleWidth(raw)));
  }

  render(width: number): string[] {
    const inner = width;
    const { colW, H } = this.metrics(inner);
    this.lastColW = colW;
    this.lastH = H;
    const fg = this.theme.fg;

    const left = this.faceCell(BIG_DEFAULT, this.selected === 0, colW, H);
    const right = this.faceCell(CUBIS_DEFAULT, this.selected === 1, colW, H);
    const div = fg("accent", "│");
    const emptyDivider = `${" ".repeat(colW)} ${div} ${" ".repeat(colW)}`;
    const rows = left.map((l, i) => `${l} ${div} ${right[i]}`);
    const labelRow = `${this.label("dcdev", this.selected === 0, colW)} ${div} ${this.label("cubis", this.selected === 1, colW)}`;

    return [
      emptyDivider,
      ...rows,
      emptyDivider,
      labelRow,
      emptyDivider,
    ];
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.left) || matchesKey(data, Key.up)) {
      this.selected = 0;
    } else if (matchesKey(data, Key.right) || matchesKey(data, Key.down) || matchesKey(data, Key.tab)) {
      this.selected = 1;
    } else if (matchesKey(data, Key.enter)) {
      this.onPick?.(this.selected === 1 ? "cubis" : "dcdev");
    } else if (matchesKey(data, Key.escape)) {
      this.onCancel?.();
    }
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel") return undefined;
    if (event.button !== "left" || (event.type !== "press" && event.type !== "click")) {
      return undefined;
    }
    if (event.y < 1 || event.y > 1 + this.lastH + 2) return undefined;
    const side = event.x > this.lastColW + 1 ? 1 : 0;
    if (event.type === "press") {
      this.selected = side as 0 | 1;
      return { handled: true };
    }
    this.selected = side as 0 | 1;
    this.onPick?.(side === 1 ? "cubis" : "dcdev");
    return { handled: true };
  }
}

/**
 * Abre el modal flotante de duelo de perfiles en DcWindow.
 */
export async function openProfilePicker(ctx: ExtensionContext): Promise<string | undefined> {
  const current = readFacePrefs().profile as "dcdev" | "cubis";
  let activeDuel: ProfileDuel | undefined;

  return openDcModal<string>(ctx, {
    title: "⛩  Dc Studio - Perfil de Carita",
    width: 62,
    maxHeight: 24,
    scrollable: false,
    showScrollbar: false,
    footer: (theme) => ({
      left: ` ${theme.fg("accent", "←→")} ${theme.fg("muted", "elegir")}  ·  ${theme.fg("accent", "Enter")} ${theme.fg("muted", "usar")}  ·  ${theme.fg("accent", "Esc")} ${theme.fg("muted", "cerrar")}`,
      right: theme.fg("accent", "[ Usar ]"),
    }),
    onFooterRightClick: () => {
      if (activeDuel) {
        const chosen = activeDuel.selected === 1 ? "cubis" : "dcdev";
        activeDuel.onPick?.(chosen);
      }
    },
    content: (done) => {
      const theme: DuelTheme = {
        fg: (role, text) => {
          if (role === "accent") return `\x1b[38;2;255;77;77m${text}\x1b[0m`;
          if (role === "error") return `\x1b[38;2;255;51;51m${text}\x1b[0m`;
          if (role === "dim" || role === "muted") return `\x1b[2m${text}\x1b[22m`;
          return text;
        },
        bold: (text) => `\x1b[1m${text}\x1b[22m`,
      };

      const duel = new ProfileDuel(theme, current);
      activeDuel = duel;
      duel.onPick = (chosen) => {
        writeFacePrefs({ profile: chosen });
        dcNotifier.notify(ctx, "DC Face", `Perfil cambiado a: ${chosen}`, "info");
        done(chosen);
      };
      duel.onCancel = () => done(undefined);
      return duel;
    },
  });
}
