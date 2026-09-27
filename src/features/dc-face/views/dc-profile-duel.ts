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
import { listFaceProfiles } from "../art/index.ts";
import type { FaceProfile } from "../core/dc-face-types.ts";
import { paintBigLine } from "../art/painter.ts";
import { readFacePrefs, writeFacePrefs } from "../core/dc-face-prefs.ts";
import { dcNotifier } from "../../../integrations/dc-notify/dc-notifier.ts";

export interface DuelTheme {
  fg: (role: string, text: string) => string;
  bold: (text: string) => string;
}

/**
 * ProfileDuel N-way: Renderiza dinámicamente N perfiles de caritas lado a lado
 * con divisores verticales continuos `│`, navegación con flechas `← →` y clic de mouse.
 */
export class ProfileDuel implements Component {
  public selectedIndex: number = 0;
  public profiles: FaceProfile[];
  public onPick?: (profileId: string) => void;
  public onCancel?: () => void;
  private lastColWidths: number[] = [];
  private lastH: number = 10;

  constructor(
    private theme: DuelTheme,
    currentProfileId = "dcdev",
  ) {
    this.profiles = listFaceProfiles();
    const idx = this.profiles.findIndex((p) => p.id === currentProfileId);
    this.selectedIndex = idx >= 0 ? idx : 0;
  }

  invalidate(): void {}

  private metrics(inner: number) {
    const N = Math.max(1, this.profiles.length);
    const divWidthTotal = (N - 1) * 3;
    const colW = Math.max(20, Math.floor((inner - divWidthTotal) / N));
    const maxFaceH = Math.max(...this.profiles.map((p) => p.defaultFace.length), 3);
    return { colW, H: maxFaceH };
  }

  private faceCell(lines: readonly string[], selected: boolean, colW: number, H: number): string[] {
    const fg = this.theme.fg;
    const w = Math.max(1, ...lines.map((l) => visibleWidth(l)));
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
    const { colW, H } = this.metrics(width);
    this.lastH = H;
    const fg = this.theme.fg;
    const div = fg("accent", "│");
    const N = this.profiles.length;

    this.lastColWidths = Array(N).fill(colW);

    // 1. Celdas de cada carita
    const faceColumns = this.profiles.map((p, idx) =>
      this.faceCell(p.defaultFace, idx === this.selectedIndex, colW, H),
    );

    // 2. Líneas vacías de separación con barras divisoras
    const emptyRow = faceColumns.map(() => " ".repeat(colW)).join(` ${div} `);

    // 3. Filas de caras unidas por el divisor vertical
    const faceRows: string[] = [];
    for (let rowIdx = 0; rowIdx < H; rowIdx++) {
      const cells = faceColumns.map((col) => col[rowIdx] ?? " ".repeat(colW));
      faceRows.push(cells.join(` ${div} `));
    }

    // 4. Fila de etiquetas radio
    const labels = this.profiles.map((p, idx) =>
      this.label(p.id, idx === this.selectedIndex, colW),
    );
    const labelRow = labels.join(` ${div} `);

    return [
      emptyRow,
      ...faceRows,
      emptyRow,
      labelRow,
      emptyRow,
    ];
  }

  handleInput(data: string): void {
    const N = this.profiles.length;
    if (matchesKey(data, Key.left) || matchesKey(data, Key.up)) {
      this.selectedIndex = (this.selectedIndex - 1 + N) % N;
    } else if (matchesKey(data, Key.right) || matchesKey(data, Key.down) || matchesKey(data, Key.tab)) {
      this.selectedIndex = (this.selectedIndex + 1) % N;
    } else if (matchesKey(data, Key.enter)) {
      const chosen = this.profiles[this.selectedIndex];
      if (chosen) {
        this.onPick?.(chosen.id);
      }
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

    let accumulatedX = 0;
    let clickedCol = -1;
    for (let i = 0; i < this.lastColWidths.length; i++) {
      const w = this.lastColWidths[i]!;
      if (event.x >= accumulatedX && event.x <= accumulatedX + w + 1) {
        clickedCol = i;
        break;
      }
      accumulatedX += w + 3;
    }

    if (clickedCol >= 0 && clickedCol < this.profiles.length) {
      this.selectedIndex = clickedCol;
      if (event.type === "click") {
        this.onPick?.(this.profiles[clickedCol]!.id);
      }
      return { handled: true };
    }

    return undefined;
  }
}

/**
 * Abre el selector modal N-way de perfiles de carita montado sobre openDcModal y DcWindow.
 */
export async function openProfileDuelModal(ctx: ExtensionContext): Promise<string | undefined> {
  const prefs = readFacePrefs();
  let selectedId = prefs.profile ?? "dcdev";
  const profilesCount = listFaceProfiles().length;

  const modalWidth = `${Math.min(94, Math.max(62, profilesCount * 24 + 6))}%`;

  return openDcModal<string>(ctx, {
    title: "Dc Studio - Selector de Perfiles",
    glyph: "⛩ ",
    frame: "double",
    paddingX: 0,
    width: modalWidth as any,
    footer: (theme) => ({
      left: `  ${theme.fg("accent", "←→")} elegir   ${theme.fg("accent", "Enter")} usar   ${theme.fg("accent", "esc")} cerrar`,
      right: `${theme.fg("accent", "[ Usar ]")}  `,
    }),
    onFooterRightClick: () => {
      writeFacePrefs({ profile: selectedId });
      dcNotifier.notify(ctx, "Caritas", `Perfil seleccionado: ${selectedId}`, "info");
    },
    content: (done, theme, tui) => {
      const duel = new ProfileDuel(
        {
          fg: (role, text) => theme.fg(role as any, text),
          bold: (text) => theme.bold(text),
        },
        selectedId,
      );

      duel.onPick = (profileId) => {
        selectedId = profileId;
        writeFacePrefs({ profile: profileId });
        dcNotifier.notify(ctx, "Caritas", `Perfil cambiado a: ${profileId}`, "info");
        done(profileId);
      };

      duel.onCancel = () => {
        done(undefined);
      };

      return {
        render: (w: number) => duel.render(w),
        invalidate: () => duel.invalidate(),
        handleInput: (data: string) => {
          duel.handleInput(data);
          tui.requestRender();
        },
        handleMouse: (event) => {
          const res = duel.handleMouse(event);
          if (res) tui.requestRender();
          return res;
        },
      };
    },
  });
}

export const openProfilePicker = openProfileDuelModal;
