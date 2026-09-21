import {
  InteractiveMode,
  SessionSelectorComponent,
  TreeSelectorComponent,
  ExtensionInputComponent,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Spacer, type Component } from "@earendil-works/pi-tui";
import { DcWindow } from "../../ui/dc-window.ts";
import {
  CleanExtensionSelectPanel,
  getSafeTheme,
  splitPanel,
  titleOf,
  plainOf,
  isHintLine,
  PATCHED,
  REV_SYM,
  ORIG_SYM,
  SELECTOR_LAYOUT_PATCHED,
  SESSION_CMD_PATCHED,
  TREE_CMD_PATCHED,
} from "./dc-dialogs-helpers.ts";

const MODULE_REV = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const ORIG_SHOW_EXT_SELECTOR = Symbol.for("dc.dialogs.orig-show-ext-selector");
const ORIG_SHOW_EXT_INPUT = Symbol.for("dc.dialogs.orig-show-ext-input");
const ORIG_SHOW_SELECTOR = Symbol.for("dc.dialogs.orig-show-selector");

let dialogsEnabled = true;
let isPatchInstalled = false;

function resolveSafeTheme(candidate: any, thisArg?: any): Theme {
  try {
    if (candidate && typeof candidate.fg === "function") {
      candidate.fg("accent", "");
      return candidate;
    }
  } catch {}
  return getSafeTheme(thisArg);
}

function markDcWindow(win: DcWindow): DcWindow {
  (win as unknown as Record<symbol, unknown>)[Symbol.for("dc.window")] = true;
  return win;
}

interface OriginalMethods {
  showExtensionCustom?: any;
  handleSessionCommand?: any;
  showSessionSelector?: any;
  showTreeSelector?: any;
  showExtensionSelector?: any;
  showExtensionInput?: any;
  showSelector?: any;
}

const originals: OriginalMethods = {};

export function isDialogsEnabled(): boolean {
  return dialogsEnabled;
}

export function setDialogsEnabled(val: boolean): void {
  dialogsEnabled = val;
}

export function installDialogsPatch(): void {
  const proto = (InteractiveMode as unknown as { prototype?: Record<string | symbol, any> })?.prototype;
  if (!proto) return;

  // ── 1. Intercept showExtensionCustom ──────────────────────────────
  const currentCustom = proto.showExtensionCustom;
  if (typeof currentCustom === "function" && currentCustom[REV_SYM] !== MODULE_REV) {
    if (!originals.showExtensionCustom) {
      originals.showExtensionCustom = currentCustom[ORIG_SYM] ?? currentCustom;
    }
    const origCustom = originals.showExtensionCustom;

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

    const patchedCustom = function (
      this: unknown,
      factory: (tui: unknown, theme: Theme, kb: unknown, done: (r: unknown) => void) => Component | Promise<Component>,
      options?: { overlay?: boolean; overlayOptions?: any },
    ): unknown {
      if (!dialogsEnabled) {
        return origCustom.call(this, factory, options);
      }

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

      if (!options?.overlay) return origCustom.call(this, factory, options);

      let offsetX = 0;
      let offsetY = 0;

      const wrapped = async (
        tui: unknown,
        rawTheme: Theme,
        kb: unknown,
        done: (r: unknown) => void,
      ): Promise<Component> => {
        const theme = resolveSafeTheme(rawTheme, this);
        const inner = await factory(tui, theme, kb, done);
        if (
          !inner ||
          (inner as unknown as Record<symbol, unknown>)[Symbol.for("dc.window")] === true ||
          inner instanceof DcWindow
        ) {
          return inner;
        }

        const onMove = (dx: number, dy: number) => {
          offsetX += dx;
          offsetY += dy;
          if (options?.overlayOptions && typeof options.overlayOptions === "object") {
            options.overlayOptions.offsetX = offsetX;
            options.overlayOptions.offsetY = offsetY;
          }
          (tui as any)?.requestRender?.();
        };

        // AgentsView integration
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
              ...(options.overlayOptions || {}),
            };
          }

          if ((agentsView as any).deps) {
            (agentsView as any).deps.rows = () => targetBodyRows + 3;
          }

          let currentTitle = "Agents";
          let currentFooter: string | undefined = undefined;

          const content: Component = {
            render: (bodyW: number) => {
              const raw = (agentsView.render?.(bodyW) ?? []) as string[];
              if (raw.length <= 3) return raw;

              const firstPlain = plainOf(raw[0] ?? "");
              const extractedTitle = firstPlain
                .replace(/^[╭┌╔]─*\s*/, "")
                .replace(/\s*─+.*$/, "")
                .replace(/❀/g, "")
                .trim();
              if (extractedTitle) currentTitle = extractedTitle;

              if (raw.length >= 2) {
                const keysLine = raw[raw.length - 2] ?? "";
                const extractedFooter = plainOf(keysLine).replace(/^[│║]\s*/, "").replace(/\s*[│║]$/, "").trim();
                if (extractedFooter) currentFooter = extractedFooter;
              }

              const bodyLines = raw.slice(1, raw.length - 2);
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
              const adjustedEvent = {
                ...event,
                y: (event.y ?? 0) + 1,
              };
              const res = agentsView.handleMouse?.(adjustedEvent) ?? inner.handleMouse?.(adjustedEvent);
              if (res) effectiveTui?.requestRender?.();
              return res;
            },
          };

          const agentsFooter = `${theme.fg("accent", "↑/↓ / Clic")} elegir subagente   ${theme.fg("accent", "Rueda/PgUp/Dn")} scroll hilo   ${theme.fg("accent", "o/enter")} ver sesión   ${theme.fg("accent", "s")} detener   ${theme.fg("accent", "esc/q")} cerrar`;

          return markDcWindow(new DcWindow({
            title: () => currentTitle,
            glyph: "⛩ ",
            theme,
            content,
            footer: () => agentsFooter,
            onClose: () => {
              agentsView.close?.();
              done(null);
            },
            onMove,
            paddingX: 0,
            frame: "double",
            maxHeight: targetWindowRows,
            solidBackground: true,
          }));
        }

        // SddModelPanel integration
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
              ...(options.overlayOptions || {}),
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
                  start++;
                  while (start < raw.length && plainOf(raw[start] ?? "") === "") start++;
                  let end = raw.length - 1;
                  while (end >= 0 && plainOf(raw[end] ?? "") === "") end--;
                  end--;
                  return raw.slice(start, Math.max(start, end + 1));
                }
                return raw;
              }

              const raw = (modelPanel.render(bodyW) ?? []) as string[];
              if (raw.length <= 2) return raw;

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

          return markDcWindow(new DcWindow({
            title: titleFn,
            glyph: "⛩ ",
            theme,
            content,
            footer: footerFn,
            onClose: () => {
              modelPanel.done?.({ type: "cancel" });
              done({ type: "cancel" });
            },
            onMove,
            paddingX: 1,
            frame: "double",
            maxHeight: targetWindowRows,
            solidBackground: true,
          }));
        }

        // ProfilesPanel integration
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
              ...(options.overlayOptions || {}),
            };
          }

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
              const adjustedEvent = {
                ...event,
                y: (event.y ?? 0) + 1,
              };
              const res = profilesPanel.handleMouse?.(adjustedEvent) ?? inner.handleMouse?.(adjustedEvent);
              if (res) effectiveTui?.requestRender?.();
              return res;
            },
          };

          const profilesFooter = () =>
            dynamicFeedback ??
            `${theme.fg("accent", "↑/↓ / Clic")} perfil   ${theme.fg("accent", "Enter")} aplicar   ${theme.fg("accent", "s")} snapshot   ${theme.fg("accent", "p/P")} pin   ${theme.fg("accent", "j/k")} scroll detalle   ${theme.fg("accent", "c/r/d/x")} acciones   ${theme.fg("accent", "esc")} cerrar`;

          return markDcWindow(new DcWindow({
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
            onMove,
            paddingX: 0,
            frame: "double",
            maxHeight: targetWindowRows,
            solidBackground: true,
          }));
        }

        // CommandPalette integration
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
              ...(options.overlayOptions || {}),
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
              if (start < raw.length && plainOf(raw[start] ?? "").startsWith("Commands")) {
                start++;
              }

              let end = raw.length - 1;
              while (end >= start && (plainOf(raw[end] ?? "") === "" || /^[╰└╝]/.test(plainOf(raw[end] ?? "")))) {
                end--;
              }
              if (end >= start && isHintLine(plainOf(raw[end] ?? ""))) {
                end--;
              }
              while (end >= start && plainOf(raw[end] ?? "").replace(/^[│║]\s*/, "").replace(/\s*[│║]$/, "") === "") {
                end--;
              }

              const bodyLines = raw.slice(start, Math.max(start, end + 1));
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

              if (type === "move" || type === "hover") {
                const target = lineItemMap.get(y);
                if (target && (commandPalette as any).selected !== target.index) {
                  (commandPalette as any).selected = target.index;
                  effectiveTui?.requestRender?.();
                  return { handled: true };
                }
              }

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

          return markDcWindow(new DcWindow({
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
            onMove,
            paddingX: 1,
            frame: "double",
            maxHeight: targetWindowRows,
            solidBackground: true,
          }));
        }

        // McpPanel integration
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
              ...(options.overlayOptions || {}),
            };
          }

          let currentExtractedTitle = "MCP Servers";
          let currentExtractedFooter: string | undefined = undefined;

          const content: Component = {
            render: (bodyW: number) => {
              const raw = (mcpPanel.render?.(bodyW) ?? inner.render?.(bodyW) ?? []) as string[];
              if (raw.length <= 3) return raw;

              let start = 0;
              while (start < raw.length && plainOf(raw[start] ?? "") === "") start++;
              if (start < raw.length) {
                const firstPlain = plainOf(raw[start] ?? "");
                if (firstPlain.includes("MCP")) {
                  currentExtractedTitle = firstPlain.replace(/^[╭┌╔]─*\s*/, "").replace(/\s*─+.*$/, "").trim() || "MCP Servers";
                  start++;
                }
              }

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

          return markDcWindow(new DcWindow({
            title: () => currentExtractedTitle || "MCP Servers — DC Studio",
            glyph: "🔌 ",
            theme,
            content,
            footer: () => currentExtractedFooter || defaultFooter,
            onClose: () => {
              (mcpPanel as any).cleanup?.();
              done({ cancelled: true, changes: new Map(), disabledChanges: new Map() });
            },
            onMove,
            paddingX: 1,
            frame: "double",
            maxHeight: targetWindowRows,
            solidBackground: true,
          }));
        }

        // Fullscreen overlays: keep native
        const oo = options?.overlayOptions;
        if (oo && (oo.width === "100%" || oo.maxHeight === "100%" || oo.margin === 0)) {
          return inner;
        }

        const name = (inner as { constructor?: { name?: string } })?.constructor?.name;
        if (name === "UsageView" || name === "WorktreeChangesView") {
          return inner;
        }

        try {
          const probe = (inner.render?.(100) ?? []) as string[];
          const firstLine = probe.find((l) => l !== undefined && plainOf(l) !== "");
          if (firstLine && /^[╭┌╔]/.test(plainOf(firstLine))) {
            return inner;
          }

          const split = splitPanel(inner);
          return markDcWindow(new DcWindow({
            title: split.title ?? titleOf(inner),
            glyph: "⛩ ",
            theme,
            content: split.body,
            footer: split.footer,
            onClose: () => done(undefined),
            onMove,
            paddingX: 0,
            frame: "double",
            solidBackground: true,
          }));
        } catch {
          return inner;
        }
      };

      return origCustom.call(this, wrapped, options);
    };

    (patchedCustom as unknown as Record<symbol, unknown>)[REV_SYM] = MODULE_REV;
    (patchedCustom as unknown as Record<symbol, unknown>)[ORIG_SYM] = origCustom;
    proto.showExtensionCustom = patchedCustom;
    (proto as Record<symbol, boolean>)[PATCHED] = true;
  }

  // ── 2. Intercept handleSessionCommand (/session) ──────────────────
  if (!originals.handleSessionCommand && typeof proto.handleSessionCommand === "function") {
    originals.handleSessionCommand = proto.handleSessionCommand;
    const origSessionCmd = originals.handleSessionCommand;
    (proto as Record<symbol, boolean>)[SESSION_CMD_PATCHED] = true;

    proto.handleSessionCommand = function (this: any): void {
      if (!dialogsEnabled) {
        return origSessionCmd.call(this);
      }
      try {
        const stats = this.session?.getSessionStats?.();
        if (!stats) {
          return origSessionCmd.call(this);
        }

        const sessionName = this.sessionManager?.getSessionName?.();
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

        void this.showExtensionCustom(
          (_tui: unknown, rawTheme: Theme, _kb: unknown, done: (r: unknown) => void) => {
            const theme = resolveSafeTheme(rawTheme, this);
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

            return markDcWindow(new DcWindow({
              title: "⛩  Dc Studio - Sesiones",
              theme,
              content,
              footer: "esc / enter / click [X] para cerrar",
              onClose: () => done(undefined),
              paddingX: 2,
              frame: "double",
              solidBackground: true,
            }));
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

  // ── 3. Intercept showSessionSelector (/resume) ────────────────────
  if (!originals.showSessionSelector && typeof proto.showSessionSelector === "function") {
    originals.showSessionSelector = proto.showSessionSelector;
    const origShowSessionSelector = originals.showSessionSelector;
    (proto as Record<symbol, boolean>)[SELECTOR_LAYOUT_PATCHED] = true;

    proto.showSessionSelector = function (this: any): void {
      if (!dialogsEnabled) {
        return origShowSessionSelector.call(this);
      }
      try {
        const SessionManager = (this.sessionManager as any)?.constructor;
        if (!SessionManager) {
          return origShowSessionSelector.call(this);
        }

        void this.showExtensionCustom(
          (_tui: unknown, rawTheme: Theme, _kb: unknown, done: (r: unknown) => void) => {
            const theme = resolveSafeTheme(rawTheme, this);
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
                renameSession: async (sessionFilePath: string, nextName: string | undefined) => {
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
              return scope === "all"
                ? "⛩  Dc Studio - Sesiones (Todas)"
                : "⛩  Dc Studio - Sesiones";
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

            return markDcWindow(new DcWindow({
              title: titleFn,
              theme,
              content: selector,
              footer: footerFn,
              onClose: () => {
                done(undefined);
                this.ui.requestRender();
              },
              paddingX: 1,
              frame: "double",
              solidBackground: true,
            }));
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

  // ── 4. Intercept showTreeSelector (/tree) ─────────────────────────
  if (!originals.showTreeSelector && typeof proto.showTreeSelector === "function") {
    originals.showTreeSelector = proto.showTreeSelector;
    const origShowTreeSelector = originals.showTreeSelector;
    (proto as Record<symbol, boolean>)[TREE_CMD_PATCHED] = true;

    proto.showTreeSelector = function (this: any, initialSelectedId?: string): void {
      if (!dialogsEnabled) {
        return origShowTreeSelector.call(this, initialSelectedId);
      }
      try {
        const tree = this.sessionManager?.getTree?.();
        if (!tree || tree.length === 0) {
          this.showStatus?.("No entries in session");
          return;
        }
        const realLeafId = this.sessionManager.getLeafId();

        void this.showExtensionCustom(
          (tui: any, rawTheme: Theme, _kb: any, done: (r: any) => void) => {
            const theme = resolveSafeTheme(rawTheme, this);
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
                  this.chatContainer?.clear?.();
                  this.renderInitialMessages?.();
                } catch (e: any) {
                  this.showError?.(`Navigation error: ${e.message}`);
                }
              },
              () => {
                done(undefined);
                this.ui?.requestRender?.();
              },
              (entryId: string, label: string | undefined) => {
                if (label !== undefined) {
                  this.sessionManager?.appendLabelChange?.(entryId, label);
                }
                this.ui?.requestRender?.();
              },
              initialSelectedId,
              this.settingsManager?.getTreeFilterMode?.(),
            );

            return markDcWindow(new DcWindow({
              title: "⛩  Dc Studio - Árbol de Sesiones",
              theme,
              content: selector,
              footer: "↑/↓: navegar  ·  Enter: saltar a turno  ·  esc: cerrar",
              onClose: () => {
                done(undefined);
                this.ui?.requestRender?.();
              },
              paddingX: 1,
              frame: "double",
              solidBackground: true,
            }));
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

  // ── 5. Intercept showExtensionSelector & showExtensionInput ───────
  if (!originals.showExtensionSelector && typeof proto.showExtensionSelector === "function") {
    originals.showExtensionSelector = proto.showExtensionSelector;
    proto[ORIG_SHOW_EXT_SELECTOR] = originals.showExtensionSelector;
    const origShowExtSelector = originals.showExtensionSelector;

    proto.showExtensionSelector = function (
      this: any,
      title: string,
      options: string[],
      opts?: any,
    ): Promise<string | undefined> {
      if (!dialogsEnabled) {
        return origShowExtSelector.call(this, title, options, opts);
      }
      return new Promise((resolve) => {
        if (opts?.signal?.aborted) {
          resolve(undefined);
          return;
        }
        const firstLine = (title ?? "").split("\n")[0]?.trim() || "Selección";
        let countdownSeconds: number | undefined = opts?.timeout ? Math.ceil(opts.timeout / 1000) : undefined;
        let timer: NodeJS.Timeout | null = null;

        void this.showExtensionCustom(
          (tui: any, rawTheme: Theme, _kb: any, done: (val: string | undefined) => void) => {
            const theme = resolveSafeTheme(rawTheme, this);
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

            return markDcWindow(new DcWindow({
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
              solidBackground: true,
            }));
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

  if (!originals.showExtensionInput && typeof proto.showExtensionInput === "function") {
    originals.showExtensionInput = proto.showExtensionInput;
    proto[ORIG_SHOW_EXT_INPUT] = originals.showExtensionInput;
    const origShowExtInput = originals.showExtensionInput;

    proto.showExtensionInput = function (
      this: any,
      title: string,
      placeholder?: string,
      opts?: any,
    ): Promise<string | undefined> {
      if (!dialogsEnabled) {
        return origShowExtInput.call(this, title, placeholder, opts);
      }
      return new Promise((resolve) => {
        if (opts?.signal?.aborted) {
          resolve(undefined);
          return;
        }
        void this.showExtensionCustom(
          (_tui: any, rawTheme: Theme, _kb: any, done: (val: string | undefined) => void) => {
            const theme = resolveSafeTheme(rawTheme, this);
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

            return markDcWindow(new DcWindow({
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
              solidBackground: true,
            }));
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

  // ── 6. Intercept showSelector ─────────────────────────────────────
  if (!originals.showSelector && typeof proto.showSelector === "function") {
    originals.showSelector = proto.showSelector;
    proto[ORIG_SHOW_SELECTOR] = originals.showSelector;
    const origShowSelector = originals.showSelector;

    proto.showSelector = function (this: any, create: any): void {
      if (!dialogsEnabled) {
        return origShowSelector.call(this, create);
      }

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

          const targetList = isSettings ? comp.getSettingsList?.() : created.focus;
          if (targetList && typeof targetList.handleInput === "function") {
            comp.handleInput = (data: string) => targetList.handleInput(data);
          }

          const win = markDcWindow(new DcWindow({
            title: winTitle,
            glyph: isScopedModels ? "⛩ " : "⚙ ",
            theme,
            content: comp,
            footer,
            onClose: () => done(),
            paddingX: 1,
            frame: "double",
            solidBackground: true,
          }));

          win.handleInput = (data: string): boolean => {
            if (targetList && typeof targetList.handleInput === "function") {
              const hasSubmenu = Boolean((targetList as any).submenuComponent);
              const handled = targetList.handleInput(data);
              if (hasSubmenu || handled) {
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

          Object.defineProperty(win, "theme", {
            get: () => getSafeTheme(this),
          });

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

  isPatchInstalled = true;
}

export function uninstallDialogsPatch(): void {
  const proto = (InteractiveMode as unknown as { prototype?: Record<string | symbol, any> })?.prototype;
  if (!proto) return;

  if (originals.showExtensionCustom) {
    proto.showExtensionCustom = originals.showExtensionCustom;
    delete originals.showExtensionCustom;
  }
  if (originals.handleSessionCommand) {
    proto.handleSessionCommand = originals.handleSessionCommand;
    delete originals.handleSessionCommand;
  }
  if (originals.showSessionSelector) {
    proto.showSessionSelector = originals.showSessionSelector;
    delete originals.showSessionSelector;
  }
  if (originals.showTreeSelector) {
    proto.showTreeSelector = originals.showTreeSelector;
    delete originals.showTreeSelector;
  }
  if (originals.showExtensionSelector) {
    proto.showExtensionSelector = originals.showExtensionSelector;
    delete originals.showExtensionSelector;
  }
  if (originals.showExtensionInput) {
    proto.showExtensionInput = originals.showExtensionInput;
    delete originals.showExtensionInput;
  }
  if (originals.showSelector) {
    proto.showSelector = originals.showSelector;
    delete originals.showSelector;
  }

  delete proto[PATCHED];
  delete proto[SESSION_CMD_PATCHED];
  delete proto[SELECTOR_LAYOUT_PATCHED];
  delete proto[TREE_CMD_PATCHED];
  delete proto[ORIG_SHOW_EXT_SELECTOR];
  delete proto[ORIG_SHOW_EXT_INPUT];
  delete proto[ORIG_SHOW_SELECTOR];

  isPatchInstalled = false;
}
