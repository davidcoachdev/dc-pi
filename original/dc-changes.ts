/**
 * dc-changes — Visor de cambios Git y diffs en dos paneles (DcWindow Win 3.1 style).
 *
 * Muestra los archivos modificados, agregados y untracked del repositorio en un
 * modal flotante interactivo:
 *   - Panel izquierdo: Lista de archivos con estado (M, A, ?, D) en color.
 *   - Panel derecho: Visor de diff en tiempo real con resaltado de sintaxis (+ verde, - rojo).
 *   - Soporta repositorios con o sin commits previos (fallback a --no-index).
 *
 * Control total por teclado y mouse:
 *   - ↑ / ↓ o clic: cambiar de archivo
 *   - Rueda del mouse sobre el diff o PgUp/PgDn: scrollear el diff
 *   - 'o' o Enter: abrir archivo en editor externo ($VISUAL o $EDITOR)
 *   - 'r': refrescar cambios en vivo
 *   - Esc / q o clic en [ X ]: cerrar
 *
 * Disparadores:
 *   - Atajo: Alt+F
 *   - Comandos: /changes, /dc-changes, /gentle:changes
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import * as path from "node:path";
import { DcWindow } from "./dc-window.ts";

export interface GitFileChange {
  status: string; // "M", "A", "??", "D", "R"
  file: string;
}

function getGitChanges(cwd: string): GitFileChange[] {
  try {
    const out = execFileSync("git", ["status", "--porcelain=v1"], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const lines = out.split("\n").filter((l) => l.trim().length > 0);
    return lines.map((line) => {
      const status = line.slice(0, 2).trim();
      const file = line.slice(3).trim();
      return { status, file };
    });
  } catch {
    return [];
  }
}

function getFileDiff(cwd: string, file: string): string[] {
  let raw = "";
  try {
    raw = execFileSync("git", ["diff", "HEAD", "--", file], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e: any) {
    if (e.stdout) raw = e.stdout;
  }

  // Fallback si no hay commits (HEAD no existe) o si es un archivo untracked
  if (!raw.trim()) {
    try {
      raw = execFileSync("git", ["diff", "--no-index", "--", "/dev/null", file], {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e: any) {
      if (e.stdout) raw = e.stdout;
    }
  }

  if (!raw.trim()) {
    return ["", "  (Sin diferencias o archivo vacío)"];
  }

  return raw.split("\n");
}

class ChangesPanel implements Component {
  private files: GitFileChange[] = [];
  private selectedIndex = 0;
  private fileListOffset = 0;
  private diffScrollOffset = 0;
  private currentDiffLines: string[] = [];
  private leftWidth = 32;
  private lastRows = 10;

  constructor(
    private readonly cwd: string,
    private readonly theme: Theme,
    private readonly tui: TUI,
    private readonly onClose: () => void,
  ) {
    this.refresh();
  }

  invalidate(): void {}

  public refresh(): void {
    this.files = getGitChanges(this.cwd);
    if (this.selectedIndex >= this.files.length) {
      this.selectedIndex = Math.max(0, this.files.length - 1);
    }
    this.loadDiffForSelected();
    this.tui.requestRender();
  }

  private loadDiffForSelected(): void {
    this.diffScrollOffset = 0;
    const item = this.files[this.selectedIndex];
    if (!item) {
      this.currentDiffLines = ["", "  No hay cambios en el working tree (repositorio limpio)."];
      return;
    }
    this.currentDiffLines = getFileDiff(this.cwd, item.file);
  }

  private openInEditor(): void {
    const item = this.files[this.selectedIndex];
    if (!item) return;
    const fullPath = path.resolve(this.cwd, item.file);
    const editor = process.env.VISUAL || process.env.EDITOR || "nvim";
    try {
      spawnSync(editor, [fullPath], { stdio: "inherit" });
      this.refresh();
    } catch {
      /* noop */
    }
  }

  render(width: number): string[] {
    const t = this.theme;
    const innerW = Math.max(20, width);
    const termRows = this.tui.terminal?.rows ?? (process.stdout?.rows ?? 30);
    // maxHeight del overlay es 92% del terminal
    const maxWindowRows = Math.max(10, Math.floor(termRows * 0.92));
    // DcWindow: top(1) + title(1) + rule(1) + rule footer(1) + footer(1) + bottom(1) = 6
    // Headers internos de ChangesPanel: columnas(1) + separador(1) = 2
    // Total filas fijas de chrome = 8
    const rows = Math.max(3, maxWindowRows - 8);
    this.lastRows = rows;

    // Asegurar que la selección permanezca visible dentro del viewport
    if (this.selectedIndex < this.fileListOffset) {
      this.fileListOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.fileListOffset + rows) {
      this.fileListOffset = Math.max(0, this.selectedIndex - rows + 1);
    }

    // Reparto de ancho: 32 cols para la lista de archivos, el resto para el diff
    this.leftWidth = Math.min(42, Math.max(24, Math.floor(innerW * 0.32)));
    const rightWidth = Math.max(10, innerW - this.leftWidth - 3);

    const pad = (s: string, len: number) => {
      const v = visibleWidth(s);
      return v >= len ? truncateToWidth(s, len, "") : s + " ".repeat(len - v);
    };

    const out: string[] = [];

    // Encabezado de columnas
    const leftHead = t.bold(t.fg("accent", pad(` Archivos (${this.files.length})`, this.leftWidth)));
    const rightHead = t.bold(t.fg("accent", pad(" Diff / Contenido", rightWidth)));
    out.push(`${leftHead} ${t.fg("border", "│")} ${rightHead}`);
    out.push(`${t.fg("border", "─".repeat(this.leftWidth))}─${t.fg("border", "┼")}─${t.fg("border", "─".repeat(rightWidth))}`);

    // Cuerpo de dos paneles
    const visibleFiles = this.files.slice(this.fileListOffset, this.fileListOffset + rows);
    const visibleDiff = this.currentDiffLines.slice(this.diffScrollOffset, this.diffScrollOffset + rows);

    for (let i = 0; i < rows; i++) {
      // 1. Columna izquierda: archivo
      const fileIdx = this.fileListOffset + i;
      const fileItem = this.files[fileIdx];
      let leftCol = " ".repeat(this.leftWidth);

      if (fileItem) {
        const isSelected = fileIdx === this.selectedIndex;
        let stColor = "muted";
        if (fileItem.status.includes("M")) stColor = "warning";
        else if (fileItem.status.includes("A") || fileItem.status === "??") stColor = "success";
        else if (fileItem.status.includes("D")) stColor = "error";

        const tag = t.fg(stColor as Parameters<Theme["fg"]>[0], pad(fileItem.status || "M", 2));
        const filename = pad(fileItem.file, this.leftWidth - 4);
        const rowContent = ` ${tag} ${filename}`;

        if (isSelected) {
          leftCol = t.bg("selectedBg", t.bold(rowContent));
        } else {
          leftCol = t.fg("text", rowContent);
        }
      }

      // 2. Columna derecha: diff
      const diffLine = visibleDiff[i] ?? "";
      let rightCol = " ".repeat(rightWidth);

      if (diffLine) {
        if (diffLine.startsWith("+") && !diffLine.startsWith("+++")) {
          rightCol = t.fg("success", pad(diffLine, rightWidth));
        } else if (diffLine.startsWith("-") && !diffLine.startsWith("---")) {
          rightCol = t.fg("error", pad(diffLine, rightWidth));
        } else if (diffLine.startsWith("@@")) {
          rightCol = t.fg("accent", pad(diffLine, rightWidth));
        } else if (diffLine.startsWith("diff ") || diffLine.startsWith("index ")) {
          rightCol = t.fg("dim", pad(diffLine, rightWidth));
        } else {
          rightCol = t.fg("text", pad(diffLine, rightWidth));
        }
      }

      out.push(`${leftCol} ${t.fg("border", "│")} ${rightCol}`);
    }

    return out;
  }

  handleMouse(event: TuiMouseEvent): { handled: boolean } | undefined {
    const { type } = event;
    const x = (event as { x?: number }).x ?? 0;
    const y = (event as { y?: number }).y ?? 0;
    const delta = (event as { wheelDelta?: number }).wheelDelta ?? 0;

    // Rueda del mouse
    if (type === "wheel" && delta !== 0) {
      if (x <= this.leftWidth) {
        // Scroll en lista de archivos
        if (delta > 0) {
          this.selectedIndex = Math.min(this.files.length - 1, this.selectedIndex + 1);
        } else {
          this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        }
        this.loadDiffForSelected();
        this.tui.requestRender();
        return { handled: true };
      } else {
        // Scroll en el diff
        const maxScroll = Math.max(0, this.currentDiffLines.length - this.lastRows);
        if (delta > 0) {
          this.diffScrollOffset = Math.min(maxScroll, this.diffScrollOffset + 3);
        } else {
          this.diffScrollOffset = Math.max(0, this.diffScrollOffset - 3);
        }
        this.tui.requestRender();
        return { handled: true };
      }
    }

    // Clic del mouse en la lista izquierda
    if (type === "click" && y >= 2) {
      const clickedRow = y - 2;
      const targetIdx = this.fileListOffset + clickedRow;
      if (targetIdx < this.files.length) {
        this.selectedIndex = targetIdx;
        this.loadDiffForSelected();
        this.tui.requestRender();
        return { handled: true };
      }
    }

    return undefined;
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, Key.up)) {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.loadDiffForSelected();
        this.tui.requestRender();
      }
      return true;
    }
    if (matchesKey(data, Key.down)) {
      if (this.selectedIndex < this.files.length - 1) {
        this.selectedIndex++;
        this.loadDiffForSelected();
        this.tui.requestRender();
      }
      return true;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.diffScrollOffset = Math.max(0, this.diffScrollOffset - this.lastRows);
      this.tui.requestRender();
      return true;
    }
    if (matchesKey(data, Key.pageDown)) {
      const maxScroll = Math.max(0, this.currentDiffLines.length - this.lastRows);
      this.diffScrollOffset = Math.min(maxScroll, this.diffScrollOffset + this.lastRows);
      this.tui.requestRender();
      return true;
    }
    if (data === "r" || data === "R") {
      this.refresh();
      return true;
    }
    if (data === "o" || data === "O" || matchesKey(data, Key.enter)) {
      this.openInEditor();
      return true;
    }
    if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
      this.onClose();
      return true;
    }
    return false;
  }
}

async function showChangesWindow(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI || ctx.mode !== "tui") return;

  await ctx.ui.custom<void>(
    (tui, theme, _kb, done) =>
      new DcWindow({
        title: "Changes — DC Studio Git Viewer",
        glyph: "📂 ",
        theme,
        content: new ChangesPanel(ctx.cwd, theme, tui, () => done()),
        footer: `${theme.fg("accent", "↑/↓ / Clic")} elegir archivo   ${theme.fg("accent", "Rueda/PgUp/Dn")} scroll diff   ${theme.fg("accent", "o/enter")} editar   ${theme.fg("accent", "r")} refrescar   ${theme.fg("accent", "esc/q")} cerrar`,
        onClose: () => done(),
        paddingX: 1,
        frame: "double",
      }),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "94%", maxHeight: "92%" },
    },
  );
}

// ── Apertura externa de Changes (desde sidebar, atajos, etc.) ─────────
const G_OPEN_CHANGES = Symbol.for("dc.changes.open");
(globalThis as unknown as Record<symbol, unknown>)[G_OPEN_CHANGES] = (ctx?: ExtensionContext) => {
  if (ctx) void showChangesWindow(ctx);
};

export default function dcChangesExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    (globalThis as unknown as Record<symbol, unknown>)[G_OPEN_CHANGES] = () => {
      void showChangesWindow(ctx);
    };
  });

  // Atajo global: Alt+F
  pi.registerShortcut("alt+f", {
    description: "dc: visor interactivo de cambios git (diffs en dos paneles)",
    handler: async (ctx) => {
      await showChangesWindow(ctx);
    },
  });

  // Comandos manuales
  pi.registerCommand("changes", {
    description: "Visor interactivo de cambios git con diff en dos paneles",
    handler: async (_args, ctx) => {
      await showChangesWindow(ctx);
    },
  });

  pi.registerCommand("dc-changes", {
    description: "Visor interactivo de cambios git con diff en dos paneles",
    handler: async (_args, ctx) => {
      await showChangesWindow(ctx);
    },
  });

  // Alias para pisar el comando nativo de gentle-pi si se llama manualmente
  pi.registerCommand("gentle:changes", {
    description: "Visor interactivo de cambios git (DC Studio)",
    handler: async (_args, ctx) => {
      await showChangesWindow(ctx);
    },
  });
}
