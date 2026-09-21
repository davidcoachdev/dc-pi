/**
 * dc-keys — Keyboard Shortcuts custom de DC Studio (ventana DcWindow).
 *
 * Muestra una ventana con cards de atajos de teclado estilo DC Studio,
 * organizadas por categorías (tabs horizontales):
 *   - General (navegación del chat y mensajes)
 *   - TUI Input (edición en el prompt)
 *   - Other (atajos de la app: modelos, tree, search, etc.)
 *   - Extensions (atajos reales dinámicos de DC Studio y extensiones activas)
 *
 * Soporta navegación completa por teclado (←/→, ↑/↓, buscador) y MOUSE:
 *   - Rueda del mouse para scroll suave en la tabla
 *   - Clic en las pestañas para cambiar de categoría
 *   - Clic en el botón [ ⟳ Actualizar (r) ] para refrescar la lista de atajos en vivo
 *     (sin reiniciar la UI de Pi)
 *   - Tecla 'r' dentro del modal para actualizar la lista de atajos
 *
 * Atajos para abrir:
 *   - Alt+?
 *   - /teclas o /keys
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { DcWindow } from "./dc-window.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Configurar que gentle-pi desactive su atajo propio de changes (evita conflicto con dc-changes que usa Alt+F)
if (!process.env.GENTLE_PI_SHELL_CHANGES_KEY || process.env.GENTLE_PI_SHELL_CHANGES_KEY === "alt+f") {
  process.env.GENTLE_PI_SHELL_CHANGES_KEY = "off";
}

const KEYBINDINGS_PATH = path.join(os.homedir(), ".pi", "agent", "keybindings.json");

/** Asegura que Alt+F quede libre de tui.editor.cursorWordRight del core para que dc-changes lo use sin conflictos */
function enforceKeybindings(): void {
  try {
    let cfg: Record<string, unknown> = {};
    if (fs.existsSync(KEYBINDINGS_PATH)) {
      cfg = JSON.parse(fs.readFileSync(KEYBINDINGS_PATH, "utf8"));
    }
    const current = cfg["tui.editor.cursorWordRight"];
    const needsUpdate =
      !current ||
      (Array.isArray(current) && current.includes("alt+f")) ||
      current === "alt+f";

    if (needsUpdate) {
      cfg["tui.editor.cursorWordRight"] = ["alt+right", "ctrl+right"];
      fs.writeFileSync(KEYBINDINGS_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
    }
  } catch {
    /* noop */
  }
}
enforceKeybindings();

const G_INTERACTIVE = Symbol.for("dc.interactive-mode");
const G_WIDGET_HOST = Symbol.for("dc.sidebar.widget-host");

interface Row {
  key: string;
  action: string;
}

interface Category {
  title: string;
  rows: Row[];
}

function formatKeyDisplay(k: string): string {
  return k
    .split("+")
    .map((part) => {
      const p = part.trim();
      if (p.toLowerCase() === "ctrl") return "Ctrl";
      if (p.toLowerCase() === "alt") return "Alt";
      if (p.toLowerCase() === "shift") return "Shift";
      if (p.toLowerCase() === "super") return "Super";
      if (p.length === 1) return p.toUpperCase();
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join("+");
}

/** Obtiene los atajos de extensiones registrados en vivo en la sesión de Pi. */
function getLiveExtensionShortcuts(): Row[] {
  const liveRows: Row[] = [];
  try {
    const im =
      (globalThis as unknown as Record<symbol, any>)[G_INTERACTIVE] ??
      (globalThis as unknown as Record<symbol, any>)[G_WIDGET_HOST];
    if (im?.session?.extensionRunner && im?.keybindings) {
      const runner = im.session.extensionRunner;
      const kb = im.keybindings;
      const shortcuts = runner.getShortcuts(kb.getEffectiveConfig());
      if (shortcuts && typeof shortcuts[Symbol.iterator] === "function") {
        for (const [key, shortcut] of shortcuts) {
          const desc = shortcut.description ?? shortcut.extensionPath ?? "Extensión";
          liveRows.push({
            key: formatKeyDisplay(key),
            action: desc,
          });
        }
      }
    }
  } catch {
    /* noop */
  }

  // Fallback si no hay runner o está vacío
  if (liveRows.length === 0) {
    return [
      { key: "F5 / Alt+F5", action: "reload (recargar extensiones, skills, prompts, temas y atajos)" },
      { key: "Alt+F", action: "changes (visor de cambios de código / diffs en dos paneles)" },
      { key: "Alt+E", action: "estado (ver entorno, git, mcps, plugins y herramientas)" },
      { key: "Alt+K", action: "command palette (paleta curada de comandos Gentle)" },
      { key: "Alt+C", action: "carita: duelo dcdev vs cubis, elegí perfil con flechas o mouse" },
      { key: "Alt+M", action: "modelos (tres paneles: providers + modelos + effort)" },
      { key: "Alt+Shift+Q", action: "quota (dos paneles: providers + detalle, con mouse)" },
      { key: "Alt+Shift+B", action: "sidebar (mostrar u ocultar el panel lateral derecho)" },
      { key: "Alt+Shift+V", action: "previu (manager visual en pane tmux/herdr)" },
      { key: "Alt+A", action: "subagentes (árbol e inspector de subagentes en ejecución)" },
      { key: "Alt+S", action: "detener subagente(s) activo(s)" },
      { key: "Ctrl+Shift+A", action: "colapsar / expandir la tarjeta de agents en el sidebar" },
      { key: "Ctrl+Shift+T", action: "colapsar / expandir la lista de tareas (todo) en el sidebar" },
      { key: "Ctrl+Shift+S", action: "revisar resultados de búsqueda web" },
      { key: "Ctrl+Shift+W", action: "activar / desactivar actividad de web search" },
      { key: "Alt+?", action: "abrir este panel interactivo de Keyboard Shortcuts" },
    ];
  }

  // Asegurar que Alt+? esté visible si no vino en el runner
  if (!liveRows.some((r) => r.key.toLowerCase().includes("alt+?"))) {
    liveRows.push({ key: "Alt+?", action: "abrir este panel interactivo de Keyboard Shortcuts" });
  }

  return liveRows;
}

function getInitialCategories(): Category[] {
  return [
    {
      title: "General",
      rows: [
        { key: "Up / Down", action: "Browse command / prompt history" },
        { key: "PageUp / PageDown", action: "Scroll message transcript by page" },
        { key: "Home / End", action: "Jump to start / latest message in transcript" },
        { key: "Ctrl+Shift+Up/Down", action: "Jump to previous / next marked message" },
        { key: "Ctrl+Shift+F", action: "Search rendered message transcript" },
        { key: "Enter / Ctrl+G", action: "Next match while searching transcript" },
        { key: "Shift+Enter", action: "Previous match while searching transcript" },
        { key: "Escape", action: "Close transcript search" },
      ],
    },
    {
      title: "TUI Input",
      rows: [
        { key: "Left / Right", action: "Move cursor left / right" },
        { key: "Alt+Left / Alt+Right", action: "Move cursor word left / right" },
        { key: "Home / End", action: "Move to line start / line end" },
        { key: "Ctrl+A / Ctrl+E", action: "Move to line start / line end (emacs)" },
        { key: "Enter", action: "Send message" },
        { key: "Shift+Enter/Ctrl+J", action: "New line" },
        { key: "Ctrl+W/Alt+Backspace", action: "Delete word backwards" },
        { key: "Alt+D/Alt+Delete", action: "Delete word forwards" },
        { key: "Ctrl+U", action: "Delete to start of line" },
        { key: "Ctrl+K", action: "Delete to end of line" },
        { key: "Ctrl+Y", action: "Paste the most-recently-deleted text" },
        { key: "Alt+Y", action: "Cycle through the deleted text after pasting" },
        { key: "Alt+Z", action: "Undo" },
      ],
    },
    {
      title: "Other",
      rows: [
        { key: "Tab", action: "Path completion / accept autocomplete" },
        { key: "Escape", action: "Cancel autocomplete / abort streaming" },
        { key: "Ctrl+C", action: "Clear editor (first) / exit (second)" },
        { key: "Ctrl+D", action: "Exit (when editor is empty)" },
        { key: "Ctrl+Z", action: "Suspend to background" },
        { key: "Shift+Tab", action: "Cycle thinking level" },
        { key: "Ctrl+P / Alt+P", action: "Cycle models" },
        { key: "Ctrl+L", action: "Open model selector" },
        { key: "Ctrl+O", action: "Toggle tool output expansion" },
        { key: "Ctrl+T", action: "Toggle thinking block visibility" },
        { key: "Ctrl+G", action: "Edit message in external editor" },
        { key: "Ctrl+X", action: "Copy last assistant message" },
        { key: "Ctrl+Q", action: "Queue follow-up message" },
        { key: "Alt+Q", action: "Restore queued messages" },
        { key: "Ctrl+V", action: "Paste image or text from clipboard" },
        { key: "/", action: "Slash commands" },
        { key: "!", action: "Run bash command" },
        { key: "!!", action: "Run bash command (excluded from context)" },
      ],
    },
    {
      title: "Extensions",
      rows: getLiveExtensionShortcuts(),
    },
  ];
}

interface TabHit {
  cat: number;
  xStart: number;
  xEnd: number;
}

/** Panel: tabs de categorías + tabla Key/Action con scroll y soporte mouse. */
class KeysPanel implements Component {
  private categories: Category[];
  private cat = 0;
  private scroll = 0;
  private rows = 12;
  private filter = "";
  private tabHits: TabHit[] = [];
  private reloadHit = { xStart: 0, xEnd: 0 };
  private updatedNotice = "";

  constructor(
    private readonly theme: Theme,
    private readonly tui: TUI,
    private readonly done: () => void,
  ) {
    this.categories = getInitialCategories();
  }

  invalidate(): void {}

  /** Actualiza la lista de atajos dinámicamente sin recargar la UI de Pi. */
  public refreshHotkeys(): void {
    const extCat = this.categories.find((c) => c.title === "Extensions");
    if (extCat) {
      extCat.rows = getLiveExtensionShortcuts();
    }
    this.updatedNotice = "✔ atajos actualizados";
    this.redraw();
    setTimeout(() => {
      this.updatedNotice = "";
      this.redraw();
    }, 2000);
  }

  /** Filas de la categoría actual, filtradas por el texto de búsqueda. */
  private filtered(): Row[] {
    const rows = this.categories[this.cat]?.rows ?? [];
    const f = this.filter.trim().toLowerCase();
    return f ? rows.filter((r) => `${r.key} ${r.action}`.toLowerCase().includes(f)) : rows;
  }

  private maxScroll(): number {
    return Math.max(0, this.filtered().length - this.rows);
  }

  private redraw(): void {
    this.tui.requestRender();
  }

  private table(width: number): string[] {
    const t = this.theme;
    const keyW = Math.max(16, Math.floor(width * 0.40));
    // Action completa el ancho → la tabla cierra justo contra el borde.
    const actW = Math.max(8, width - keyW - 3);

    const line = (s: string, w: number) => {
      const clipped = visibleWidth(s) > w ? truncateToWidth(s, w, "") : s;
      return clipped + " ".repeat(Math.max(0, w - visibleWidth(clipped)));
    };
    const bar = (l: string, m: string, r: string) =>
      t.fg("border", l + "─".repeat(keyW) + m + "─".repeat(actW) + r);
    const row = (k: string, a: string) =>
      t.fg("border", "│") +
      " " +
      line(t.fg("accent", k), keyW - 1) +
      t.fg("border", "│") +
      " " +
      line(t.fg("text", a), actW - 1) +
      t.fg("border", "│");

    // Fila de cabecera con FONDO (paleta DcWindow)
    const header = (k: string, a: string) => {
      const plain = "│ " + line(k, keyW - 1) + "│ " + line(a, actW - 1) + "│";
      return t.bg("selectedBg", t.fg("accent", t.bold(plain)));
    };
    // Fila cebra
    const rowAlt = (k: string, a: string) => {
      const plain = "│ " + line(k, keyW - 1) + "│ " + line(a, actW - 1) + "│";
      return t.bg("userMessageBg", t.fg("text", plain));
    };

    const out: string[] = [];
    out.push(bar("┌", "┬", "┐"));
    out.push(header("Key", "Action"));
    const rows = this.filtered();
    const visible = rows.slice(this.scroll, this.scroll + this.rows);
    visible.forEach((r, i) => {
      out.push(bar("├", "┼", "┤"));
      out.push(i % 2 === 1 ? rowAlt(r.key, r.action) : row(r.key, r.action));
    });
    // Relleno hasta llenar el alto fijo
    for (let i = visible.length; i < this.rows; i++) {
      out.push(bar("├", "┼", "┤"));
      out.push(row("", ""));
    }
    out.push(bar("└", "┴", "┘"));
    return out;
  }

  render(width: number): string[] {
    const t = this.theme;
    const out: string[] = [];

    // Construir tabs y calcular coordenadas para clic de mouse
    this.tabHits = [];
    let currentX = 1; // 1 de margen inicial
    const renderedTabs: string[] = [];

    for (let i = 0; i < this.categories.length; i++) {
      const cat = this.categories[i]!;
      const label = ` ${cat.title} `;
      const w = visibleWidth(label);
      this.tabHits.push({ cat: i, xStart: currentX, xEnd: currentX + w });
      currentX += w;

      if (i === this.cat) {
        renderedTabs.push(t.bg("selectedBg", t.fg("accent", t.bold(label))));
      } else {
        renderedTabs.push(t.fg("dim", label));
      }

      if (i < this.categories.length - 1) {
        renderedTabs.push(t.fg("dim", "│"));
        currentX += 1;
      }
    }

    const tabsLine = renderedTabs.join("");

    // Botón de actualizar atajos en vivo: [ ⟳ Actualizar (r) ]
    const reloadLabel = this.updatedNotice ? ` [ ${this.updatedNotice} ] ` : " [ ⟳ Actualizar (r) ] ";
    const reloadWidth = visibleWidth(reloadLabel);
    const search =
      t.fg("accent", "\u{1F50E} ") + (this.filter ? t.fg("text", this.filter) : t.fg("dim", "buscar…"));

    const tabsW = visibleWidth(tabsLine);
    const searchW = visibleWidth(search);
    const gap = Math.max(1, width - 1 - tabsW - reloadWidth - searchW);

    this.reloadHit.xStart = tabsW + 1 + Math.floor(gap / 2);
    this.reloadHit.xEnd = this.reloadHit.xStart + reloadWidth;

    const reloadFormatted = this.updatedNotice
      ? t.fg("success", t.bold(reloadLabel))
      : t.fg("warning", t.bold(reloadLabel));

    out.push("");
    out.push(" " + tabsLine + " ".repeat(Math.max(1, Math.floor(gap / 2))) + reloadFormatted + " ".repeat(Math.max(1, Math.ceil(gap / 2))) + search);
    out.push(...this.table(width));
    return out;
  }

  handleMouse(event: TuiMouseEvent): { handled: boolean } | undefined {
    const { type } = event;
    const x = (event as { x?: number }).x ?? 0;
    const y = (event as { y?: number }).y ?? 0;

    // 1. Rueda del mouse → scroll en la tabla
    if (type === "wheel") {
      const delta = (event as { wheelDelta?: number }).wheelDelta ?? 0;
      if (delta === 0) return undefined;
      if (delta > 0) {
        this.scroll = Math.min(this.maxScroll(), this.scroll + 2);
      } else {
        this.scroll = Math.max(0, this.scroll - 2);
      }
      this.redraw();
      return { handled: true };
    }

    // 2. Clic del mouse
    if (type === "click") {
      // Clic en la fila de cabecera (y === 1)
      if (y === 1) {
        // Clic en tabs
        for (const hit of this.tabHits) {
          if (x >= hit.xStart && x <= hit.xEnd) {
            this.cat = hit.cat;
            this.scroll = 0;
            this.redraw();
            return { handled: true };
          }
        }
        // Clic en botón [ ⟳ Actualizar (r) ]
        if (x >= this.reloadHit.xStart && x <= this.reloadHit.xEnd) {
          this.refreshHotkeys();
          return { handled: true };
        }
      }

      // Clic dentro de la tabla (y >= 4)
      if (y >= 4 && y < 4 + this.rows * 2) {
        this.redraw();
        return { handled: true };
      }
    }

    return undefined;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.left)) {
      this.cat = (this.cat - 1 + this.categories.length) % this.categories.length;
      this.scroll = 0;
      this.redraw();
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.cat = (this.cat + 1) % this.categories.length;
      this.scroll = 0;
      this.redraw();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.scroll = Math.max(0, this.scroll - 1);
      this.redraw();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.scroll = Math.min(this.maxScroll(), this.scroll + 1);
      this.redraw();
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.scroll = Math.max(0, this.scroll - this.rows);
      this.redraw();
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.scroll = Math.min(this.maxScroll(), this.scroll + this.rows);
      this.redraw();
      return;
    }
    // Tecla 'r' para actualizar la lista de atajos en vivo (si no hay filtro activo)
    if ((data === "r" || data === "R") && !this.filter) {
      this.refreshHotkeys();
      return;
    }
    if (matchesKey(data, Key.escape)) {
      if (this.filter) {
        this.filter = "";
        this.scroll = 0;
        this.redraw();
        return;
      }
      this.done();
      return;
    }
    if (matchesKey(data, Key.backspace)) {
      if (this.filter) {
        this.filter = this.filter.slice(0, -1);
        this.scroll = 0;
        this.redraw();
      }
      return;
    }
    // Texto imprimible → al buscador
    if (data.length === 1) {
      const code = data.charCodeAt(0);
      if (code >= 32 && code < 127) {
        this.filter += data;
        this.scroll = 0;
        this.redraw();
      }
    }
  }
}

/** Abre la ventana de atajos. */
async function openKeys(ctx: ExtensionContext): Promise<void> {
  await ctx.ui.custom<void>(
    (tui, theme, _kb, done) =>
      new DcWindow({
        title: "Keyboard Shortcuts — DC Studio",
        glyph: "\u2328 ",
        theme,
        content: new KeysPanel(theme, tui, () => done()),
        footer: `${theme.fg("accent", "Clic/←/→")} ${theme.fg("dim", "categoría")}   ${theme.fg("accent", "Rueda/↑/↓")} ${theme.fg("dim", "scroll")}   ${theme.fg("accent", "r/Clic ⟳")} ${theme.fg("dim", "actualizar lista")}   ${theme.fg("accent", "esc")} ${theme.fg("dim", "cerrar")}`,
        onClose: () => done(),
        paddingX: 1,
        frame: "double",
      }),
    { overlay: true, overlayOptions: { anchor: "center", width: "70%", maxHeight: "85%" } },
  );
}

export default function dcKeysExtension(pi: ExtensionAPI) {
  pi.registerCommand("teclas", {
    description: "Keyboard Shortcuts (cards por categoría, navegación mouse y teclado)",
    handler: async (_args, ctx) => {
      await openKeys(ctx);
    },
  });

  pi.registerCommand("keys", {
    description: "Keyboard Shortcuts (cards por categoría, navegación mouse y teclado)",
    handler: async (_args, ctx) => {
      await openKeys(ctx);
    },
  });

  pi.registerShortcut("alt+?" as never, {
    description: "Keyboard Shortcuts (cards por categoría, mouse y teclado)",
    handler: async (ctx) => {
      await openKeys(ctx);
    },
  });
}
