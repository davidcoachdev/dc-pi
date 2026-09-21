/**
 * dc-dialogs — Aplica el chrome `DcWindow` a TODAS las ventanas emergentes.
 *
 * Fase A: engancha `InteractiveMode.showExtensionCustom` (el método por el que
 * pasa el `ctx.ui.custom(...)` de CUALQUIER extensión — nuestras y de gentle-pi)
 * y envuelve el componente del overlay en una `DcWindow` (marco doble + barra
 * de título + [X]).
 *
 * Los overlays que YA son `DcWindow` (ej. /modelos, /quota, /previu) se dejan
 * como están (no se doble-enmarcan). Los `ui.custom` inline (sin overlay) no se
 * tocan.
 *
 * Título: una extensión puede declarar `component[Symbol.for("dc.dialogs.title")]`.
 * Si no, se usa un título genérico.
 */

import {
  InteractiveMode,
  SessionSelectorComponent,
  TreeSelectorComponent,
  ExtensionSelectorComponent,
  ExtensionInputComponent,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  Spacer,
  Text,
  type Component,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { DcWindow } from "./dc-window.ts";

const PATCHED = Symbol.for("dc.dialogs.custom-patched");
const REV_SYM = Symbol.for("dc.dialogs.rev");
const ORIG_SYM = Symbol.for("dc.dialogs.orig");
const SELECTOR_LAYOUT_PATCHED = Symbol.for("dc.dialogs.session-selector-patched");
const SESSION_CMD_PATCHED = Symbol.for("dc.dialogs.session-cmd-patched");
// Rev por carga: si el prototipo quedó con un wrapper de una carga anterior,
// re-parcheamos con el código vigente (si no, seguís viendo el código viejo).
const MODULE_REV = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
export const DC_DIALOG_TITLE = Symbol.for("dc.dialogs.title");

const ANSI_RE_DLG = /\x1b\[[0-9;]*m/g;
const plainOf = (s: string) => s.replace(ANSI_RE_DLG, "").trim();
/** ¿La línea parece la barra de atajos (footer)? */
const isHintLine = (s: string) => /[•·|]|\b(esc|enter|ctrl|tab|shift|back)\b/i.test(s);

/**
 * Separa el panel en: TÍTULO (primera línea útil), FOOTER (última línea con
 * atajos) y BODY (el resto). La DcWindow los muestra en su chrome; adentro solo
 * queda el body. Todo defensivo: si algo no matchea, no toca nada.
 */
function splitPanel(inner: Component): { body: Component; title?: string; footer?: string } {
  const pickTitle = (lines: string[]): string | undefined => {
    const first = lines.find((l) => l !== undefined && plainOf(l) !== "");
    if (first && plainOf(first).length <= 60 && !isHintLine(plainOf(first))) return plainOf(first);
    return undefined;
  };
  const pickFooter = (lines: string[]): string | undefined => {
    const rev = [...lines].reverse().find((l) => l !== undefined && plainOf(l) !== "");
    if (rev && isHintLine(plainOf(rev))) return rev;
    return undefined;
  };
  let probe: string[] = [];
  try {
    probe = (inner.render?.(120) ?? []) as string[];
  } catch {
    /* noop */
  }
  const title = pickTitle(probe);
  const footer = pickFooter(probe);
  const body: Component = {
    render: (w: number): string[] => {
      const lines = (inner.render?.(w) ?? []) as string[];
      const t = pickTitle(lines);
      const f = pickFooter(lines);
      let start = 0;
      while (start < lines.length && plainOf(lines[start] ?? "") === "") start++;
      if (t) start++;
      let end = lines.length - 1;
      while (end >= 0 && plainOf(lines[end] ?? "") === "") end--;
      if (f) end--;
      return lines.slice(start, Math.max(start, end + 1));
    },
    invalidate: () => inner.invalidate?.(),
    handleInput: (d: string) => inner.handleInput?.(d),
    handleMouse: (e: unknown) => inner.handleMouse?.(e),
  } as unknown as Component;
  return { body, title, footer };
}

/** Título del overlay: el declarado, una prop `title`, su primer render, o genérico. */
function titleOf(inner: Component): string {
  try {
    const rec = inner as unknown as Record<symbol | string, unknown>;
    const declared = rec[DC_DIALOG_TITLE];
    if (typeof declared === "string" && declared.trim() !== "") return declared.trim();
    const prop = (rec as { title?: unknown }).title;
    if (typeof prop === "string" && prop.trim() !== "") return prop.trim();
    // Último recurso: la primera línea útil que renderiza el panel (los paneles de
    // gentle-pi ponen su título ahí, p.ej. "Assign Models and Effort to Agents").
    const lines = (inner as { render?: (w: number) => string[] }).render?.(120);
    if (Array.isArray(lines)) {
      for (const l of lines) {
        if (typeof l !== "string") continue;
        const clean = l.replace(/\x1b\[[0-9;]*m/g, "").trim();
        if (clean !== "") {
          if (clean.length <= 60) return clean;
          break;
        }
      }
    }
  } catch {
    /* noop */
  }
  return "Dc Studio";
}

class CleanExtensionSelectPanel implements Component {
  private selectedIndex = 0;
  private scrollOffset = 0;
  private readonly maxVisible = 10;

  constructor(
    private readonly options: string[],
    private readonly theme: Theme,
    private readonly onSelect: (opt: string) => void,
    private readonly onCancel: () => void,
    private readonly requestRender: () => void,
  ) {}

  invalidate(): void {}

  private ensureCursorVisible(): void {
    this.selectedIndex = Math.max(0, Math.min(this.options.length - 1, this.selectedIndex));
    const maxOff = Math.max(0, this.options.length - this.maxVisible);
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + this.maxVisible) {
      this.scrollOffset = Math.max(0, this.selectedIndex - this.maxVisible + 1);
    }
    this.scrollOffset = Math.max(0, Math.min(maxOff, this.scrollOffset));
  }

  render(width: number): string[] {
    const t = this.theme;
    const innerW = Math.max(10, width);
    this.ensureCursorVisible();

    const pad = (s: string, len: number) => {
      const v = visibleWidth(s);
      return v >= len ? truncateToWidth(s, len, "") : s + " ".repeat(len - v);
    };

    const visibleCount = Math.min(this.options.length, this.maxVisible);
    const visible = this.options.slice(this.scrollOffset, this.scrollOffset + visibleCount);
    const out: string[] = [];

    for (let i = 0; i < visible.length; i++) {
      const optIdx = this.scrollOffset + i;
      const isSelected = optIdx === this.selectedIndex;
      const bullet = isSelected ? t.fg("accent", "●") : t.fg("dim", "○");
      const raw = ` ${bullet} ${visible[i]}`;
      const padded = pad(raw, innerW);

      if (isSelected) {
        out.push(t.bg("selectedBg", t.bold(padded)));
      } else {
        out.push(t.fg("text", padded));
      }
    }
    return out;
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
      this.onCancel();
      return true;
    }
    if (matchesKey(data, Key.up) || data === "k") {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.ensureCursorVisible();
        this.requestRender();
      }
      return true;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      if (this.selectedIndex < this.options.length - 1) {
        this.selectedIndex++;
        this.ensureCursorVisible();
        this.requestRender();
      }
      return true;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - this.maxVisible);
      this.ensureCursorVisible();
      this.requestRender();
      return true;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.selectedIndex = Math.min(this.options.length - 1, this.selectedIndex + this.maxVisible);
      this.ensureCursorVisible();
      this.requestRender();
      return true;
    }
    if (matchesKey(data, Key.home)) {
      this.selectedIndex = 0;
      this.ensureCursorVisible();
      this.requestRender();
      return true;
    }
    if (matchesKey(data, Key.end)) {
      this.selectedIndex = Math.max(0, this.options.length - 1);
      this.ensureCursorVisible();
      this.requestRender();
      return true;
    }
    if (matchesKey(data, Key.enter) || data === " ") {
      const opt = this.options[this.selectedIndex];
      if (opt !== undefined) this.onSelect(opt);
      return true;
    }
    return false;
  }

  handleMouse(event: TuiMouseEvent): { handled: boolean } | undefined {
    const { type } = event;
    const delta = (event as { wheelDelta?: number }).wheelDelta ?? 0;
    const y = (event as { y?: number }).y ?? 0;

    if (type === "wheel" && delta !== 0) {
      if (delta > 0) {
        this.selectedIndex = Math.min(this.options.length - 1, this.selectedIndex + 1);
      } else {
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      }
      this.ensureCursorVisible();
      this.requestRender();
      return { handled: true };
    }

    if (type === "click" && (event as { button?: string }).button !== "right") {
      const clickedIdx = this.scrollOffset + y;
      if (clickedIdx >= 0 && clickedIdx < this.options.length) {
        if (this.selectedIndex === clickedIdx) {
          const opt = this.options[clickedIdx];
          if (opt !== undefined) this.onSelect(opt);
        } else {
          this.selectedIndex = clickedIdx;
          this.requestRender();
        }
        return { handled: true };
      }
    }

    return undefined;
  }
}

let activeCtx: ExtensionContext | undefined;

function createFallbackTheme(): Theme {
  return {
    name: "fallback",
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    dim: (text: string) => text,
    italic: (text: string) => text,
    underline: (text: string) => text,
    inverse: (text: string) => text,
    strikethrough: (text: string) => text,
    getFgAnsi: () => "",
    getBgAnsi: () => "",
    getColorMode: () => "truecolor",
    getThinkingBorderColor: () => (str: string) => str,
    getBashModeBorderColor: () => (str: string) => str,
  } as unknown as Theme;
}

function getSafeTheme(thisArg?: any): Theme {
  try {
    const key = Symbol.for("@earendil-works/pi-coding-agent:theme");
    const globalTheme = (globalThis as any)[key];
    if (globalTheme && typeof globalTheme.fg === "function") return globalTheme;
  } catch {}

  try {
    const oldKey = Symbol.for("@mariozechner/pi-coding-agent:theme");
    const oldTheme = (globalThis as any)[oldKey];
    if (oldTheme && typeof oldTheme.fg === "function") return oldTheme;
  } catch {}

  try {
    const fn = (globalThis as any)[Symbol.for("dc.sidebar.theme-getter")];
    if (typeof fn === "function") {
      const t = fn();
      if (t && typeof t.fg === "function") return t;
    }
  } catch {}

  try {
    if (activeCtx?.ui?.theme && typeof activeCtx.ui.theme.fg === "function") {
      return activeCtx.ui.theme;
    }
  } catch {}

  try {
    if (thisArg && typeof thisArg.createExtensionUIContext === "function") {
      const uiCtx = thisArg.createExtensionUIContext();
      if (uiCtx?.theme && typeof uiCtx.theme.fg === "function") {
        return uiCtx.theme;
      }
    }
  } catch {}

  return createFallbackTheme();
}

export default function dcDialogsExtension(pi: ExtensionAPI, ctx?: ExtensionContext) {
  if (ctx) activeCtx = ctx;
  try {
    pi.on("session_start", async (_event, sessionCtx) => {
      activeCtx = sessionCtx;
    });
  } catch {}
  try {
    const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> })?.prototype;
    if (!proto) return;

    const current = proto.showExtensionCustom as
      | ((this: unknown, factory: unknown, options?: { overlay?: boolean }) => unknown)
      | undefined;
    if (typeof current !== "function") return;
    // Ya es nuestro wrapper de ESTA carga → listo.
    if ((current as Record<symbol, unknown>)[REV_SYM] === MODULE_REV) return;
    // Si el actual es nuestro wrapper de una carga previa, encadenamos a su
    // original guardado (no anidamos wrappers entre reloads).
    const orig = ((current as Record<symbol, unknown>)[ORIG_SYM] as typeof current) ?? current;

    const findAgentsView = (c: any): any => {
      if (!c) return undefined;
      if (c[Symbol.for("dc.agents-view")] || c.constructor?.name === "AgentsView") return c;
      if (c.keyboardTarget && findAgentsView(c.keyboardTarget)) return findAgentsView(c.keyboardTarget);
      if (Array.isArray(c.children)) {
        for (const ch of c.children) {
          const f = findAgentsView(ch);
          if (f) return f;
        }
      }
      return undefined;
    };

    const patchedCustom = function (
      this: unknown,
      factory: (tui: unknown, theme: Theme, kb: unknown, done: (r: unknown) => void) => Component | Promise<Component>,
      options?: { overlay?: boolean; overlayOptions?: any },
    ): unknown {
      // Detectar Review Consent inline para proyectarlo como overlay flotante en DcWindow
      if (!options?.overlay && typeof factory === "function" && factory.toString().includes("ReviewConsent")) {
        options = {
          overlay: true,
          overlayOptions: {
            anchor: "center",
            width: "72%",
            maxHeight: "82%",
          },
        };
      }

      // Sólo los overlays flotantes (los popups). Los inline quedan igual.
      if (!options?.overlay) return orig.call(this, factory, options);

      const wrapped = async (
        tui: unknown,
        theme: Theme,
        kb: unknown,
        done: (r: unknown) => void,
      ): Promise<Component> => {
        const inner = await factory(tui, theme, kb, done);
        // No doble-enmarcar si ya es una DcWindow (marca por símbolo global).
        if (!inner || (inner as unknown as Record<symbol, unknown>)[Symbol.for("dc.window")] === true) return inner;

        // Integración especial con AgentsView: usar DcWindow con marco doble, fondo y footer de DC Studio
        const agentsView = findAgentsView(inner);
        if (agentsView) {
          const effectiveTui = tui as { terminal?: { rows?: number }; requestRender?: () => void };
          const tRows = effectiveTui?.terminal?.rows ?? (process.stdout?.rows ?? 40);
          const targetWindowRows = Math.max(12, Math.floor(tRows * 0.84));
          const targetBodyRows = Math.max(4, targetWindowRows - 6);

          if (options) {
            options.overlayOptions = {
              anchor: "center",
              width: "92%",
              maxHeight: targetWindowRows,
            };
          }

          // Override dinámico de deps.rows para que AgentsView calcule EXACTAMENTE la cantidad
          // de filas internas que caben en el cuerpo de DcWindow sin desbordar ni cortarse a lo largo.
          if ((agentsView as any).deps) {
            (agentsView as any).deps.rows = () => targetBodyRows + 3;
          }

          let currentTitle = "Agents";
          let currentFooter: string | undefined = undefined;

          const content: Component = {
            render: (bodyW: number) => {
              const raw = (agentsView.render?.(bodyW) ?? []) as string[];
              if (raw.length <= 3) return raw;

              // Extraer título dinámico de la primera línea (ej. ❀ Agents · this session · 0 active)
              const firstPlain = plainOf(raw[0] ?? "");
              const extractedTitle = firstPlain
                .replace(/^[╭┌╔]─*\s*/, "")
                .replace(/\s*─+.*$/, "")
                .replace(/❀/g, "")
                .trim();
              if (extractedTitle) currentTitle = extractedTitle;

              // Extraer footer de la penúltima línea con atajos
              if (raw.length >= 2) {
                const keysLine = raw[raw.length - 2] ?? "";
                const extractedFooter = plainOf(keysLine).replace(/^[│║]\s*/, "").replace(/\s*[│║]$/, "").trim();
                if (extractedFooter) currentFooter = extractedFooter;
              }

              // El cuerpo son las filas entre el header (línea 0) y el footer (las 2 últimas líneas)
              const bodyLines = raw.slice(1, raw.length - 2);

              // Quitar los bordes exteriores simples (│) para que calcen limpios en el borde doble de DcWindow
              return bodyLines.map((l: string) => {
                if (typeof l !== "string") return l;
                let line = l;
                if (line.startsWith("│")) line = " " + line.slice(1);
                if (line.endsWith("│")) line = line.slice(0, -1) + " ";
                return line;
              });
            },
            invalidate: () => inner.invalidate?.(),
            handleInput: (data: string) => {
              const res = inner.handleInput?.(data);
              effectiveTui?.requestRender?.();
              return res ?? true;
            },
            handleMouse: (event: any) => {
              // Mapear la coordenada Y: DcWindow le pasa y=0 a la primera fila de datos,
              // pero AgentsView espera y=1 (porque y=0 era el header que quitamos).
              const adjustedEvent = {
                ...event,
                y: (event.y ?? 0) + 1,
              };
              const res = (agentsView.handleMouse?.(adjustedEvent) ?? inner.handleMouse?.(adjustedEvent));
              if (res) effectiveTui?.requestRender?.();
              return res;
            },
          };

          const agentsFooter = `${theme.fg("accent", "↑/↓ / Clic")} elegir subagente   ${theme.fg("accent", "Rueda/PgUp/Dn")} scroll hilo   ${theme.fg("accent", "o/enter")} ver sesión   ${theme.fg("accent", "s")} detener   ${theme.fg("accent", "esc/q")} cerrar`;

          return new DcWindow({
            title: () => currentTitle,
            glyph: "⛩ ",
            theme,
            content,
            footer: () => agentsFooter,
            onClose: () => {
              agentsView.close?.();
              done(null);
            },
            paddingX: 0,
            frame: "double",
            maxHeight: targetWindowRows,
          });
        }

        // Integración especial con SddModelPanel (/gentle:models): usar DcWindow con título dinámico, marco doble y footer.
        const findSddModelPanel = (c: any): any => {
          if (!c) return undefined;
          if (c[Symbol.for("dc.sdd-model-panel")] || c.constructor?.name === "SddModelPanel") return c;
          if (c.keyboardTarget && findSddModelPanel(c.keyboardTarget)) return findSddModelPanel(c.keyboardTarget);
          if (Array.isArray(c.children)) {
            for (const ch of c.children) {
              const f = findSddModelPanel(ch);
              if (f) return f;
            }
          }
          return undefined;
        };

        const modelPanel = findSddModelPanel(inner);
        if (modelPanel) {
          const effectiveTui = tui as { terminal?: { rows?: number }; requestRender?: () => void };
          const tRows = effectiveTui?.terminal?.rows ?? (process.stdout?.rows ?? 40);
          const targetWindowRows = Math.max(12, Math.floor(tRows * 0.84));

          if (options) {
            options.overlayOptions = {
              anchor: "center",
              width: "88%",
              maxHeight: targetWindowRows,
            };
          }
          let currentExtractedTitle = "Modelos y Effort";
          let currentExtractedFooter: string | undefined = undefined;

          const content: Component = {
            render: (bodyW: number) => {
              if (typeof modelPanel.renderBare === "function") {
                const raw = modelPanel.renderBare(bodyW);
                if (modelPanel.mode === "models" || raw.some((l: string) => l.includes("Cuentas"))) {
                  return raw;
                }
                if (raw.length >= 3) {
                  let start = 0;
                  while (start < raw.length && plainOf(raw[start] ?? "") === "") start++;
                  start++; // omitir título
                  while (start < raw.length && plainOf(raw[start] ?? "") === "") start++;
                  let end = raw.length - 1;
                  while (end >= 0 && plainOf(raw[end] ?? "") === "") end--;
                  end--; // omitir footer
                  return raw.slice(start, Math.max(start, end + 1));
                }
                return raw;
              }

              // Cuando se usa el render nativo de SddModelPanel:
              const raw = (modelPanel.render(bodyW) ?? []) as string[];
              if (raw.length <= 2) return raw;

              // 1. Extraer título de la primera línea útil
              let start = 0;
              while (start < raw.length && plainOf(raw[start] ?? "") === "") start++;
              if (start < raw.length) {
                const firstPlain = plainOf(raw[start] ?? "");
                if (firstPlain && !isHintLine(firstPlain)) {
                  currentExtractedTitle = firstPlain;
                  start++;
                  while (start < raw.length && plainOf(raw[start] ?? "") === "") start++;
                }
              }

              // 2. Extraer atajos / footer de las últimas líneas útiles
              let end = raw.length - 1;
              while (end >= start && plainOf(raw[end] ?? "") === "") end--;
              const footers: string[] = [];
              while (end >= start && isHintLine(plainOf(raw[end] ?? ""))) {
                footers.unshift(plainOf(raw[end] ?? ""));
                end--;
              }
              while (end >= start && plainOf(raw[end] ?? "") === "") end--;

              if (footers.length > 0) {
                currentExtractedFooter = footers.join("   ");
              }

              return raw.slice(start, Math.max(start, end + 1));
            },
            invalidate: () => inner.invalidate?.(),
            handleInput: (data: string) => {
              const res = inner.handleInput?.(data);
              effectiveTui?.requestRender?.();
              return res ?? true;
            },
            handleMouse: (event: any) => {
              const res = inner.handleMouse?.(event);
              if (res) effectiveTui?.requestRender?.();
              return res;
            },
          };

          const titleFn = () =>
            typeof modelPanel.currentTitle === "function" ? modelPanel.currentTitle() : currentExtractedTitle;
          const footerFn = () =>
            typeof modelPanel.currentFooter === "function" ? modelPanel.currentFooter() : currentExtractedFooter;

          return new DcWindow({
            title: titleFn,
            glyph: "⛩ ",
            theme,
            content,
            footer: footerFn,
            onClose: () => {
              modelPanel.done?.({ type: "cancel" });
              done({ type: "cancel" });
            },
            paddingX: 1,
            frame: "double",
            maxHeight: targetWindowRows,
          });
        }

        // Integración especial con ProfilesPanel (/gentle:profiles): DcWindow marco doble
        const findProfilesPanel = (c: any): any => {
          if (!c) return undefined;
          if (c[Symbol.for("dc.profiles-panel")] || c.constructor?.name === "ProfilesPanel") return c;
          if (c.keyboardTarget && findProfilesPanel(c.keyboardTarget)) return findProfilesPanel(c.keyboardTarget);
          if (Array.isArray(c.children)) {
            for (const ch of c.children) {
              const f = findProfilesPanel(ch);
              if (f) return f;
            }
          }
          return undefined;
        };

        const profilesPanel = findProfilesPanel(inner);
        if (profilesPanel) {
          const effectiveTui = tui as { terminal?: { rows?: number }; requestRender?: () => void };
          const tRows = effectiveTui?.terminal?.rows ?? (process.stdout?.rows ?? 40);
          const targetWindowRows = Math.max(12, Math.floor(tRows * 0.84));
          const targetBodyRows = Math.max(4, targetWindowRows - 6);

          if (options) {
            options.overlayOptions = {
              anchor: "center",
              width: "92%",
              maxHeight: targetWindowRows,
            };
          }

          // Ajustar altura de bodyRows para que no desborde de la terminal con el marco de DcWindow
          if (typeof (profilesPanel as any).rows === "function") {
            (profilesPanel as any).rows = () => targetBodyRows + 3;
          }

          let dynamicFeedback: string | undefined = undefined;

          const content: Component = {
            render: (bodyW: number) => {
              const raw = (profilesPanel.render(bodyW) ?? []) as string[];
              if (raw.length <= 3) return raw;
              let start = 0;
              while (start < raw.length && plainOf(raw[start] ?? "") === "") start++;
              if (start < raw.length && /[╭┌╔]/.test(plainOf(raw[start] ?? ""))) start++;
              let end = raw.length - 1;
              while (end >= 0 && plainOf(raw[end] ?? "") === "") end--;
              if (end >= 0 && /[╰└╝]/.test(plainOf(raw[end] ?? ""))) end--;
              if (end >= 0 && isHintLine(plainOf(raw[end] ?? ""))) {
                const hintText = plainOf(raw[end] ?? "");
                if (hintText.includes("Snapshot") || hintText.includes("live routing")) {
                  dynamicFeedback = hintText.replace(/^[│║]\s*/, "").replace(/\s*[│║]$/, "");
                }
                end--;
              }

              const bodyLines = raw.slice(start, Math.max(start, end + 1));
              return bodyLines.map((l: string) => {
                if (typeof l !== "string") return l;
                let line = l;
                // Quitar los bordes │ externos para que calcen limpios en el marco doble ║ de DcWindow
                if (line.startsWith("│")) line = " " + line.slice(1);
                else line = line.replace(/^(\x1b\[[0-9;]*m)│/, "$1 ");
                if (line.endsWith("│")) line = line.slice(0, -1) + " ";
                else line = line.replace(/│(\x1b\[[0-9;]*m)$/, " $1");
                return line;
              });
            },
            invalidate: () => inner.invalidate?.(),
            handleInput: (data: string) => {
              const res = inner.handleInput?.(data);
              effectiveTui?.requestRender?.();
              return res ?? true;
            },
            handleMouse: (event: any) => {
              // Mapear la coordenada Y (+1) porque el layout de ProfilesPanel asume que y=0 era el borde ╭───╮
              const adjustedEvent = {
                ...event,
                y: (event.y ?? 0) + 1,
              };
              const res = (profilesPanel.handleMouse?.(adjustedEvent) ?? inner.handleMouse?.(adjustedEvent));
              if (res) effectiveTui?.requestRender?.();
              return res;
            },
          };

          const profilesFooter = () =>
            dynamicFeedback ??
            `${theme.fg("accent", "↑/↓ / Clic")} perfil   ${theme.fg("accent", "Enter")} aplicar   ${theme.fg("accent", "s")} snapshot   ${theme.fg("accent", "p/P")} pin   ${theme.fg("accent", "j/k")} scroll detalle   ${theme.fg("accent", "c/r/d/x")} acciones   ${theme.fg("accent", "esc")} cerrar`;

          return new DcWindow({
            title: "Agent Profiles — Gentle AI",
            glyph: "⛩ ",
            theme,
            content,
            footer: profilesFooter,
            onClose: () => {
              (profilesPanel as any).finish?.({ type: "close" });
              (profilesPanel as any).done?.({ type: "close" });
              done({ type: "close" });
            },
            paddingX: 0,
            frame: "double",
            maxHeight: targetWindowRows,
          });
        }

        // Integración especial con CommandPalette (/gentle:commands - Alt+K): DcWindow marco doble Win 3.1
        const findCommandPalette = (c: any): any => {
          if (!c) return undefined;
          if (c[Symbol.for("dc.command-palette")] || c.constructor?.name === "CommandPalette") return c;
          if (c.keyboardTarget && findCommandPalette(c.keyboardTarget)) return findCommandPalette(c.keyboardTarget);
          if (Array.isArray(c.children)) {
            for (const ch of c.children) {
              const f = findCommandPalette(ch);
              if (f) return f;
            }
          }
          return undefined;
        };

        const commandPalette = findCommandPalette(inner);
        if (commandPalette) {
          const effectiveTui = tui as { terminal?: { rows?: number }; requestRender?: () => void };
          const tRows = effectiveTui?.terminal?.rows ?? (process.stdout?.rows ?? 40);
          const targetWindowRows = Math.max(12, Math.floor(tRows * 0.84));
          const targetBodyRows = Math.max(4, targetWindowRows - 6);

          if (options) {
            options.overlayOptions = {
              anchor: "center",
              width: "72%",
              minWidth: 60,
              maxHeight: targetWindowRows,
            };
          }

          if (typeof (commandPalette as any).rowsFn === "function") {
            (commandPalette as any).rowsFn = () => targetBodyRows + 7;
          }

          const lineItemMap = new Map<number, { item: any; index: number }>();

          const content: Component = {
            render: (bodyW: number) => {
              lineItemMap.clear();
              const raw = (commandPalette.render(bodyW) ?? []) as string[];
              if (raw.length <= 3) return raw;

              let start = 0;
              while (start < raw.length && (plainOf(raw[start] ?? "") === "" || /^[╭┌╔]/.test(plainOf(raw[start] ?? "")))) {
                start++;
              }
              // Omitir la fila "Commands ... esc" redundante (ya está en la barra de título de DcWindow)
              if (start < raw.length && plainOf(raw[start] ?? "").startsWith("Commands")) {
                start++;
              }

              let end = raw.length - 1;
              while (end >= start && (plainOf(raw[end] ?? "") === "" || /^[╰└╝]/.test(plainOf(raw[end] ?? "")))) {
                end--;
              }
              // Omitir la fila de atajos original ("type to search • ...")
              if (end >= start && isHintLine(plainOf(raw[end] ?? ""))) {
                end--;
              }
              while (end >= start && plainOf(raw[end] ?? "").replace(/^[│║]\s*/, "").replace(/\s*[│║]$/, "") === "") {
                end--;
              }

              const bodyLines = raw.slice(start, Math.max(start, end + 1));

              // Mapear cada fila visual a su comando para soportar clic y hover con el mouse
              const allItems: Array<{ item: any; index: number }> = [];
              const groups = typeof (commandPalette as any).matches === "function"
                ? (commandPalette as any).matches()
                : ((commandPalette as any).groups ?? []);
              let itmIdx = 0;
              for (const g of groups) {
                if (Array.isArray(g.items)) {
                  for (const it of g.items) {
                    allItems.push({ item: it, index: itmIdx++ });
                  }
                }
              }

              bodyLines.forEach((l: string, yIdx: number) => {
                const plain = plainOf(l);
                for (const entry of allItems) {
                  if (entry.item?.label && plain.includes(entry.item.label)) {
                    lineItemMap.set(yIdx, entry);
                    break;
                  }
                }
              });

              return bodyLines.map((l: string) => {
                if (typeof l !== "string") return l;
                let line = l;
                // Quitar │ de los extremos para calzar limpio en el borde ║ de DcWindow
                if (line.startsWith("│")) line = " " + line.slice(1);
                else line = line.replace(/^(\x1b\[[0-9;]*m)│/, "$1 ");
                if (line.endsWith("│")) line = line.slice(0, -1) + " ";
                else line = line.replace(/│(\x1b\[[0-9;]*m)$/, " $1");
                return line;
              });
            },
            invalidate: () => inner.invalidate?.(),
            handleInput: (data: string) => {
              const res = inner.handleInput?.(data);
              effectiveTui?.requestRender?.();
              return res ?? true;
            },
            handleMouse: (event: any) => {
              const { type } = event;
              const y = event.y ?? 0;

              // 1. Rueda del mouse (wheel): navegar la lista arriba/abajo
              if (type === "wheel") {
                const delta = event.wheelDelta ?? 0;
                if (delta !== 0) {
                  if (typeof (commandPalette as any).moveSelection === "function") {
                    (commandPalette as any).moveSelection(delta > 0 ? 1 : -1);
                  } else {
                    (commandPalette as any).handleInput?.(delta > 0 ? "down" : "up");
                  }
                  effectiveTui?.requestRender?.();
                  return { handled: true };
                }
              }

              // 2. Movimiento / Hover del mouse: resaltar el comando apuntado
              if (type === "move" || type === "hover") {
                const target = lineItemMap.get(y);
                if (target && (commandPalette as any).selected !== target.index) {
                  (commandPalette as any).selected = target.index;
                  effectiveTui?.requestRender?.();
                  return { handled: true };
                }
              }

              // 3. Clic izquierdo: ejecutar el comando clickeado
              if (type === "click" && (event.button ?? "left") !== "right") {
                const target = lineItemMap.get(y);
                if (target) {
                  (commandPalette as any).selected = target.index;
                  (commandPalette as any).finish?.({ type: "run", name: target.item.command });
                  done({ type: "run", name: target.item.command });
                  return { handled: true };
                }
              }

              return undefined;
            },
          };

          const paletteFooter = `${theme.fg("accent", "↑/↓ / Rueda / Hover")} mover   ${theme.fg("accent", "Clic / Enter")} ejecutar   ${theme.fg("accent", "type")} buscar   ${theme.fg("accent", "esc")} cerrar`;

          return new DcWindow({
            title: "Command Palette — Gentle AI",
            glyph: "⛩ ",
            theme,
            content,
            footer: paletteFooter,
            onClose: () => {
              (commandPalette as any).finish?.({ type: "close" });
              (commandPalette as any).done?.({ type: "close" });
              done({ type: "close" });
            },
            paddingX: 1,
            frame: "double",
            maxHeight: targetWindowRows,
          });
        }

        // Integración especial con McpPanel (/mcp - pi-mcp-adapter): DcWindow marco doble Win 3.1
        const findMcpPanel = (c: any): any => {
          if (!c) return undefined;
          if (
            c[Symbol.for("dc.mcp-panel")] ||
            c.constructor?.name === "McpPanel" ||
            c.constructor?.name === "McpSetupPanel" ||
            c.constructor?.name === "McpPanelView" ||
            c.view?.constructor?.name === "McpPanelView"
          ) {
            return c;
          }
          if (c.keyboardTarget && findMcpPanel(c.keyboardTarget)) return findMcpPanel(c.keyboardTarget);
          if (Array.isArray(c.children)) {
            for (const ch of c.children) {
              const f = findMcpPanel(ch);
              if (f) return f;
            }
          }
          return undefined;
        };

        const mcpPanel = findMcpPanel(inner);
        if (mcpPanel) {
          const effectiveTui = tui as { terminal?: { rows?: number }; requestRender?: () => void };
          const tRows = effectiveTui?.terminal?.rows ?? (process.stdout?.rows ?? 40);
          const targetWindowRows = Math.max(14, Math.floor(tRows * 0.88));

          if (options) {
            options.overlayOptions = {
              anchor: "center",
              width: "82%",
              minWidth: 70,
              maxHeight: targetWindowRows,
            };
          }

          let currentExtractedTitle = "MCP Servers";
          let currentExtractedFooter: string | undefined = undefined;

          const content: Component = {
            render: (bodyW: number) => {
              const raw = (mcpPanel.render?.(bodyW) ?? inner.render?.(bodyW) ?? []) as string[];
              if (raw.length <= 3) return raw;

              // 1. Extraer título de la cabecera (ej: ╭─ MCP Servers ─...─╮)
              let start = 0;
              while (start < raw.length && plainOf(raw[start] ?? "") === "") start++;
              if (start < raw.length) {
                const firstPlain = plainOf(raw[start] ?? "");
                if (firstPlain.includes("MCP")) {
                  currentExtractedTitle = firstPlain.replace(/^[╭┌╔]─*\s*/, "").replace(/\s*─+.*$/, "").trim() || "MCP Servers";
                  start++;
                }
              }

              // 2. Extraer footer de las últimas líneas con atajos (ej: ↑↓ navigate • ⏎ toggle...)
              let end = raw.length - 1;
              while (end >= start && plainOf(raw[end] ?? "") === "") end--;
              if (end >= start && /[╰└╝]/.test(plainOf(raw[end] ?? ""))) end--;
              if (
                end >= start &&
                (isHintLine(plainOf(raw[end] ?? "")) ||
                  plainOf(raw[end] ?? "").includes("navigate") ||
                  plainOf(raw[end] ?? "").includes("toggle"))
              ) {
                currentExtractedFooter = plainOf(raw[end] ?? "").replace(/^[│║]\s*/, "").replace(/\s*[│║]$/, "").trim();
                end--;
              }
              while (end >= start && plainOf(raw[end] ?? "") === "") end--;

              const bodyLines = raw.slice(start, Math.max(start, end + 1));
              return bodyLines.map((l: string) => {
                if (typeof l !== "string") return l;
                let line = l;
                // Quitar bordes │ exteriores para que calcen limpios en el marco doble ║ de DcWindow
                if (line.startsWith("│")) line = " " + line.slice(1);
                else line = line.replace(/^(\x1b\[[0-9;]*m)│/, "$1 ");
                if (line.endsWith("│")) line = line.slice(0, -1) + " ";
                else line = line.replace(/│(\x1b\[[0-9;]*m)$/, " $1");
                return line;
              });
            },
            invalidate: () => inner.invalidate?.(),
            handleInput: (data: string) => {
              const res = inner.handleInput?.(data);
              effectiveTui?.requestRender?.();
              return res ?? true;
            },
            handleMouse: (event: any) => {
              const { type } = event;
              // Soporte para rueda del mouse en la lista de MCP
              if (type === "wheel") {
                const delta = event.wheelDelta ?? 0;
                if (delta !== 0) {
                  inner.handleInput?.(delta > 0 ? "\x1b[B" : "\x1b[A");
                  effectiveTui?.requestRender?.();
                  return { handled: true };
                }
              }
              return inner.handleMouse?.(event);
            },
          };

          const defaultFooter = `${theme.fg("accent", "↑/↓ / Rueda")} mover   ${theme.fg("accent", "Espacio/Enter")} activar/toggle   ${theme.fg("accent", "d/D")} direct/all   ${theme.fg("accent", "r")} reconectar   ${theme.fg("accent", "esc")} cerrar`;

          return new DcWindow({
            title: () => currentExtractedTitle || "MCP Servers — DC Studio",
            glyph: "🔌 ",
            theme,
            content,
            footer: () => currentExtractedFooter || defaultFooter,
            onClose: () => {
              (mcpPanel as any).cleanup?.();
              done({ cancelled: true, changes: new Map(), disabledChanges: new Map() });
            },
            paddingX: 1,
            frame: "double",
            maxHeight: targetWindowRows,
          });
        }

        // Vistas fullscreen restantes: respetar su 100% nativo
        const oo = options?.overlayOptions;
        if (oo && (oo.width === "100%" || oo.maxHeight === "100%" || oo.margin === 0)) {
          return inner;
        }

        // Si el componente YA trae su propio marco de gentle-pi (SddModelPanel, UsageView, WorktreeChangesView)
        const name = (inner as { constructor?: { name?: string } })?.constructor?.name;
        if (
          name === "SddModelPanel" ||
          name === "UsageView" ||
          name === "WorktreeChangesView"
        ) {
          return inner;
        }

        try {
          // Si la primera línea de render ya es un borde de caja (ej. ╭─ / ┌─ / ╔═), no re-enmarcar
          const probe = (inner.render?.(100) ?? []) as string[];
          const firstLine = probe.find((l) => l !== undefined && plainOf(l) !== "");
          if (firstLine && /^[╭┌╔]/.test(plainOf(firstLine))) {
            return inner;
          }

          // Separa título/footer del contenido: van al chrome, adentro queda el body.
          const split = splitPanel(inner);
          return new DcWindow({
            title: split.title ?? titleOf(inner),
            glyph: "⛩ ",
            theme,
            content: split.body,
            footer: split.footer,
            onClose: () => done(undefined),
            paddingX: 0,
            frame: "double",
          });
        } catch {
          return inner;
        }
      };

      return orig.call(this, wrapped, options);
    };

    (patchedCustom as Record<symbol, unknown>)[REV_SYM] = MODULE_REV;
    (patchedCustom as Record<symbol, unknown>)[ORIG_SYM] = orig;
    proto.showExtensionCustom = patchedCustom;
    (proto as Record<symbol, boolean>)[PATCHED] = true;

    // ── Patch 1: /session en ventana flotante DcWindow ──────────────────────
    if (!(proto as Record<symbol, boolean>)[SESSION_CMD_PATCHED]) {
      const origSessionCmd = proto.handleSessionCommand as (() => void) | undefined;
      if (typeof origSessionCmd === "function") {
        (proto as Record<symbol, boolean>)[SESSION_CMD_PATCHED] = true;
        proto.handleSessionCommand = function (this: any): void {
          try {
            const stats = this.session?.getSessionStats?.();
            if (!stats) {
              return origSessionCmd.call(this);
            }

            const sessionName = this.sessionManager?.getSessionName?.();
            const entries = this.sessionManager?.getEntries?.() ?? [];

            let info = "";
            if (sessionName) {
              info += `Name: ${sessionName}\n`;
            }
            info += `File: ${stats.sessionFile ?? "In-memory"}\n`;
            info += `ID:   ${stats.sessionId}\n\n`;

            info += `[ Messages ]\n`;
            info += `Total:     ${stats.totalMessages}\n`;
            info += `User:      ${stats.userMessages}\n`;
            info += `Assistant: ${stats.assistantMessages}\n`;
            info += `Tools:     ${stats.toolCalls} calls, ${stats.toolResults} results\n\n`;

            info += `[ Tokens ]\n`;
            const { input, cacheRead, cacheWrite } = stats.tokens || { input: 0, cacheRead: 0, cacheWrite: 0 };
            const promptTokens = input + cacheRead + cacheWrite;
            info += `Input:     ${promptTokens.toLocaleString()}\n`;
            if (promptTokens > 0 && (cacheRead > 0 || cacheWrite > 0)) {
              const hitRate = `(${(((cacheRead ?? 0) / promptTokens) * 100).toFixed(1)}%)`;
              info += `  Cached:   ${(cacheRead ?? 0).toLocaleString()} ${hitRate}\n`;
              const written = (cacheWrite ?? 0) > 0 ? ` (${(cacheWrite ?? 0).toLocaleString()} written to cache)` : "";
              info += `  Uncached: ${((input ?? 0) + (cacheWrite ?? 0)).toLocaleString()}${written}\n`;
            }
            info += `Output:    ${(stats.tokens?.output ?? 0).toLocaleString()}\n`;
            info += `Total:     ${(stats.tokens?.total ?? 0).toLocaleString()}\n`;

            if ((stats.cost ?? 0) > 0) {
              info += `\n[ Cost ]\n`;
              info += `Total:     $${(stats.cost ?? 0).toFixed(2)}\n`;
            }

            // Mostrar como overlay flotante con DcWindow
            void this.showExtensionCustom(
              (_tui: unknown, theme: Theme, _kb: unknown, done: (r: unknown) => void) => {
                const lines = info.trim().split("\n");
                const content: Component = {
                  render: (_width: number): string[] => {
                    return lines.map((l) => {
                      if (l.startsWith("[") && l.endsWith("]")) {
                        return theme.bold(theme.fg("accent", l));
                      }
                      const colonIdx = l.indexOf(":");
                      if (colonIdx !== -1 && !l.startsWith("  ")) {
                        const label = l.slice(0, colonIdx + 1);
                        const val = l.slice(colonIdx + 1);
                        return theme.fg("dim", label) + theme.fg("text", val);
                      }
                      return theme.fg("dim", l);
                    });
                  },
                  invalidate: () => {},
                };

                return new DcWindow({
                  title: "Session Info",
                  glyph: "⛩ ",
                  theme,
                  content,
                  footer: "esc / enter / click [X] para cerrar",
                  onClose: () => done(undefined),
                  paddingX: 2,
                  frame: "double",
                });
              },
              {
                overlay: true,
                overlayOptions: {
                  anchor: "center",
                  width: "70%",
                  maxHeight: "75%",
                },
              },
            );
          } catch {
            return origSessionCmd.call(this);
          }
        };
      }
    }

    // ── Patch 2: /resume en ventana flotante overlay DcWindow ─────────────
    if (!(proto as Record<symbol, boolean>)[SELECTOR_LAYOUT_PATCHED]) {
      const origShowSessionSelector = proto.showSessionSelector as (() => void) | undefined;
      if (typeof origShowSessionSelector === "function") {
        (proto as Record<symbol, boolean>)[SELECTOR_LAYOUT_PATCHED] = true;

        proto.showSessionSelector = function (this: any): void {
          try {
            const SessionManager = (this.sessionManager as any)?.constructor;
            if (!SessionManager) {
              return origShowSessionSelector.call(this);
            }

            void this.showExtensionCustom(
              (_tui: unknown, theme: Theme, _kb: unknown, done: (r: unknown) => void) => {
                const selector = new SessionSelectorComponent(
                  (onProgress: any) =>
                    SessionManager.list(
                      this.sessionManager.getCwd(),
                      this.sessionManager.getSessionDir(),
                      onProgress,
                    ),
                  (onProgress: any) =>
                    this.sessionManager.usesDefaultSessionDir()
                      ? SessionManager.listAll(onProgress)
                      : SessionManager.listAll(this.sessionManager.getSessionDir(), onProgress),
                  async (sessionPath: string) => {
                    done(undefined);
                    await this.handleResumeSession(sessionPath);
                  },
                  () => {
                    done(undefined);
                    this.ui.requestRender();
                  },
                  () => {
                    done(undefined);
                    void this.shutdown();
                  },
                  () => this.ui.requestRender(),
                  {
                    renameSession: async (sessionFilePath: string, nextName: string) => {
                      const next = (nextName ?? "").trim();
                      if (!next) return;
                      const mgr = SessionManager.open(sessionFilePath);
                      mgr.appendSessionInfo(next);
                    },
                    showRenameHint: true,
                    keybindings: this.keybindings,
                  },
                  this.sessionManager.getSessionFile(),
                );

                const titleFn = () => {
                  const scope = (selector as any).scope;
                  return scope === "all" ? "Resume Session (All)" : "Resume Session (Current Folder)";
                };

                const footerFn = () => {
                  try {
                    const header = (selector as any).header;
                    if (header && typeof header.render === "function") {
                      const hLines = header.render(100);
                      if (Array.isArray(hLines) && hLines.length >= 3) {
                        const h1 = hLines[1]?.trim() || "";
                        const h2 = hLines[2]?.trim() || "";
                        if (h1 && h2) return `${h1}  ·  ${h2}`;
                        return h1 || h2 || undefined;
                      }
                    }
                  } catch {}
                  return "tab scope  ·  ctrl+s sort  ·  ctrl+n named  ·  ctrl+d delete  ·  ctrl+r rename";
                };

                return new DcWindow({
                  title: titleFn,
                  glyph: "⛩ ",
                  theme,
                  content: selector,
                  footer: footerFn,
                  onClose: () => {
                    done(undefined);
                    this.ui.requestRender();
                  },
                  paddingX: 1,
                  frame: "double",
                });
              },
              {
                overlay: true,
                overlayOptions: {
                  anchor: "center",
                  width: "88%",
                  maxHeight: "85%",
                },
              },
            );
          } catch {
            return origShowSessionSelector.call(this);
          }
        };
      }
    }

    // ── Patch 3: /tree en ventana flotante overlay DcWindow ─────────────
    const TREE_CMD_PATCHED = Symbol.for("dc.dialogs.tree-cmd-patched");
    if (!(proto as Record<symbol, boolean>)[TREE_CMD_PATCHED]) {
      const origShowTreeSelector = proto.showTreeSelector as ((id?: string) => void) | undefined;
      if (typeof origShowTreeSelector === "function") {
        (proto as Record<symbol, boolean>)[TREE_CMD_PATCHED] = true;

        proto.showTreeSelector = function (this: any, initialSelectedId?: string): void {
          try {
            const tree = this.sessionManager?.getTree?.();
            if (!tree || tree.length === 0) {
              this.showStatus?.("No entries in session");
              return;
            }
            const realLeafId = this.sessionManager.getLeafId();

            void this.showExtensionCustom(
              (tui: any, theme: Theme, _kb: any, done: (r: any) => void) => {
                const selector = new TreeSelectorComponent(
                  tree,
                  realLeafId,
                  tui.terminal?.rows ?? 40,
                  async (entryId: string) => {
                    done(undefined);
                    if (entryId === this.sessionManager.getLeafId()) {
                      this.showStatus?.("Already at this point");
                      return;
                    }
                    try {
                      await this.session.navigateTree(entryId);
                      this.showStatus?.("Navigated to selected point");
                      this.chatContainer.clear();
                      this.renderInitialMessages();
                    } catch (e: any) {
                      this.showError?.(`Navigation error: ${e.message}`);
                    }
                  },
                );

                return new DcWindow({
                  title: "Session Tree — Branch Navigation",
                  glyph: "⛩ ",
                  theme,
                  content: selector,
                  footer: "↑/↓: navegar  ·  Enter: saltar a turno  ·  esc: cerrar",
                  onClose: () => {
                    done(undefined);
                    this.ui.requestRender();
                  },
                  paddingX: 1,
                  frame: "double",
                });
              },
              {
                overlay: true,
                overlayOptions: {
                  anchor: "center",
                  width: "88%",
                  maxHeight: "85%",
                },
              },
            );
          } catch {
            return origShowTreeSelector.call(this, initialSelectedId);
          }
        };
      }
    }

    // ── Patch 4: Diálogos de extensión (select, confirm, input) como modales DcWindow ──
    const ORIG_SHOW_EXT_SELECTOR = Symbol.for("dc.dialogs.orig-show-ext-selector");
    const ORIG_SHOW_EXT_INPUT = Symbol.for("dc.dialogs.orig-show-ext-input");

    if (!proto[ORIG_SHOW_EXT_SELECTOR]) {
      proto[ORIG_SHOW_EXT_SELECTOR] = proto.showExtensionSelector;
    }
    if (!proto[ORIG_SHOW_EXT_INPUT]) {
      proto[ORIG_SHOW_EXT_INPUT] = proto.showExtensionInput;
    }

    const origShowExtSelector = proto[ORIG_SHOW_EXT_SELECTOR] as ((...a: any[]) => Promise<any>) | undefined;
    const origShowExtInput = proto[ORIG_SHOW_EXT_INPUT] as ((...a: any[]) => Promise<any>) | undefined;

    if (typeof origShowExtSelector === "function") {
      proto.showExtensionSelector = function (
        this: any,
        title: string,
        options: string[],
        opts?: any,
      ): Promise<string | undefined> {
        return new Promise((resolve) => {
          if (opts?.signal?.aborted) {
            resolve(undefined);
            return;
          }
          const firstLine = (title ?? "").split("\n")[0]?.trim() || "Selección";
          let countdownSeconds: number | undefined = opts?.timeout ? Math.ceil(opts.timeout / 1000) : undefined;
          let timer: NodeJS.Timeout | null = null;

          void this.showExtensionCustom(
            (tui: any, theme: Theme, _kb: any, done: (val: string | undefined) => void) => {
              if (countdownSeconds && countdownSeconds > 0) {
                timer = setInterval(() => {
                  if (countdownSeconds && countdownSeconds > 0) {
                    countdownSeconds--;
                    tui.requestRender?.();
                    if (countdownSeconds === 0) {
                      if (timer) clearInterval(timer);
                      done(undefined);
                      resolve(undefined);
                    }
                  }
                }, 1000);
              }

              const panel = new CleanExtensionSelectPanel(
                options,
                theme,
                (option: string) => {
                  if (timer) clearInterval(timer);
                  done(option);
                  resolve(option);
                },
                () => {
                  if (timer) clearInterval(timer);
                  done(undefined);
                  resolve(undefined);
                },
                () => tui.requestRender?.(),
              );

              const titleFn = () =>
                countdownSeconds !== undefined ? `${firstLine} (${countdownSeconds}s)` : firstLine;

              return new DcWindow({
                title: titleFn,
                glyph: "⛩ ",
                theme,
                content: panel,
                footer: `${theme.fg("accent", "↑/↓ / Clic")} elegir   ${theme.fg("accent", "Enter")} aplicar   ${theme.fg("accent", "esc/q")} cancelar`,
                onClose: () => {
                  if (timer) clearInterval(timer);
                  done(undefined);
                  resolve(undefined);
                },
                paddingX: 1,
                frame: "double",
              });
            },
            {
              overlay: true,
              overlayOptions: {
                anchor: "center",
                width: "50%",
                maxHeight: `${Math.min(75, Math.max(22, options.length * 6 + 15))}%`,
              },
            },
          );
        });
      };
    }

    if (typeof origShowExtInput === "function") {
      proto.showExtensionInput = function (
        this: any,
        title: string,
        placeholder?: string,
        opts?: any,
      ): Promise<string | undefined> {
        return new Promise((resolve) => {
          if (opts?.signal?.aborted) {
            resolve(undefined);
            return;
          }
          void this.showExtensionCustom(
            (_tui: any, theme: Theme, _kb: any, done: (val: string | undefined) => void) => {
              const input = new ExtensionInputComponent(
                title,
                placeholder,
                (value: string) => {
                  done(value);
                  resolve(value);
                },
                () => {
                  done(undefined);
                  resolve(undefined);
                },
                { tui: this.ui, timeout: opts?.timeout },
              );

              return new DcWindow({
                title: title || "Input",
                glyph: "⛩ ",
                theme,
                content: input,
                footer: "Enter: confirmar  ·  esc: cancelar",
                onClose: () => {
                  done(undefined);
                  resolve(undefined);
                },
                paddingX: 1,
                frame: "double",
              });
            },
            {
              overlay: true,
              overlayOptions: {
                anchor: "center",
                width: "55%",
                maxHeight: "45%",
              },
            },
          );
        });
      };
    }

    // ── Patch 5: Settings y Configuración como ventana flotante overlay DcWindow ──
    const ORIG_SHOW_SELECTOR = Symbol.for("dc.dialogs.orig-show-selector");
    if (!proto[ORIG_SHOW_SELECTOR]) {
      proto[ORIG_SHOW_SELECTOR] = proto.showSelector;
    }
    const origShowSelector = proto[ORIG_SHOW_SELECTOR] as ((create: any) => void) | undefined;
    if (typeof origShowSelector === "function") {
      proto.showSelector = function (this: any, create: any): void {
        let isOverlaySelector = false;
        let overlayHandle: any;

        const wrappedCreate = (origDone: any) => {
          let closed = false;
          const done = () => {
            if (closed) return;
            closed = true;
            if (overlayHandle) {
              try {
                overlayHandle.hide();
              } catch {}
              overlayHandle = undefined;
            }
            origDone();
            try {
              this.editorContainer?.clear?.();
              if (this.editor) this.editorContainer?.addChild?.(this.editor);
              this.ui?.setFocus?.(this.editor);
              this.ui?.requestRender?.();
            } catch {}
          };

          const created = create(done);
          if (!created?.component) return created;

          const comp = created.component;
          const name = comp.constructor?.name;
          const isSettings =
            name === "SettingsSelectorComponent" ||
            typeof comp.getSettingsList === "function";
          const isConfig = name === "ConfigSelectorComponent";
          const isScopedModels = name === "ScopedModelsSelectorComponent";

          if (isSettings || isConfig || isScopedModels) {
            isOverlaySelector = true;
            const theme = getSafeTheme(this);
            const winTitle = isScopedModels
              ? "Modelos Habilitados — Scoped Models"
              : isConfig
              ? "Configuración de Paquetes — DC Studio"
              : "Configuración — DC Studio";

            const footer = `${theme.fg("accent", "↑/↓ / Clic")} navegar   ${theme.fg("accent", "Enter/Espacio")} cambiar   ${theme.fg("accent", "esc")} cerrar`;

            // Enrutar input directamente a la lista interactiva
            const targetList = isSettings ? comp.getSettingsList?.() : created.focus;
            if (targetList && typeof targetList.handleInput === "function") {
              comp.handleInput = (data: string) => targetList.handleInput(data);
            }

            const win = new DcWindow({
              title: winTitle,
              glyph: isScopedModels ? "⛩ " : "⚙ ",
              theme,
              content: comp,
              footer,
              onClose: () => done(),
              paddingX: 1,
              frame: "double",
            });

            // Delegación de input y atajos para la ventana flotante
            win.handleInput = (data: string): boolean => {
              if (targetList && typeof targetList.handleInput === "function") {
                const hasSubmenu = Boolean((targetList as any).submenuComponent);
                const handled = targetList.handleInput(data);
                if (hasSubmenu) {
                  this.ui?.requestRender?.();
                  return true;
                }
                if (handled) {
                  this.ui?.requestRender?.();
                  return true;
                }
              }
              if (data === "\x1b") {
                done();
                return true;
              }
              return false;
            };

            // Asegurar que el tema de la ventana se mantenga sincronizado
            Object.defineProperty(win, "theme", {
              get: () => getSafeTheme(this),
            });

            // Lanzar como ventana flotante overlay en el centro de la terminal
            try {
              overlayHandle = this.ui.showOverlay(win, {
                anchor: "center",
                width: "82%",
                maxHeight: "82%",
              });
            } catch {
              isOverlaySelector = false;
            }

            return {
              component: win,
              focus: win,
              dispose: () => {
                done();
                created.dispose?.();
              },
            };
          }
          return created;
        };

        origShowSelector.call(this, (done: any) => {
          const res = wrappedCreate(done);
          if (isOverlaySelector && overlayHandle) {
            return {
              component: new Spacer(0),
              focus: res.focus,
              dispose: res.dispose,
            };
          }
          return res;
        });
      };
    }
  } catch {
    /* noop */
  }
}
