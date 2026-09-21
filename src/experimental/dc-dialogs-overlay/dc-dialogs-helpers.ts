import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const DC_DIALOG_TITLE = Symbol.for("dc.dialogs.title");
export const REV_SYM = Symbol.for("dc.dialogs.rev");
export const ORIG_SYM = Symbol.for("dc.dialogs.orig");
export const PATCHED = Symbol.for("dc.dialogs.custom-patched");
export const SELECTOR_LAYOUT_PATCHED = Symbol.for("dc.dialogs.session-selector-patched");
export const SESSION_CMD_PATCHED = Symbol.for("dc.dialogs.session-cmd-patched");
export const TREE_CMD_PATCHED = Symbol.for("dc.dialogs.tree-cmd-patched");

export const ANSI_RE_DLG = /\x1b\[[0-9;]*m/g;
export const plainOf = (s: string): string => s.replace(ANSI_RE_DLG, "").trim();
export const isHintLine = (s: string): boolean => /[•·|]|\b(esc|enter|ctrl|tab|shift|back)\b/i.test(s);

/**
 * Splits panel into title (first line), footer (bottom line with hints), and body.
 * Strips title and footer lines from arbitrary inner components so DcWindow
 * can display them cleanly in its chrome.
 */
export function splitPanel(inner: Component): { body: Component; title?: string; footer?: string } {
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
    handleMouse: (e: unknown) => inner.handleMouse?.(e as any),
  } as unknown as Component;

  return { body, title, footer };
}

/** Extracts title from DC_DIALOG_TITLE symbol, `title` property, first line of render, or fallback "Dc Studio". */
export function titleOf(inner: Component): string {
  try {
    const rec = inner as unknown as Record<symbol | string, unknown>;
    const declared = rec[DC_DIALOG_TITLE];
    if (typeof declared === "string" && declared.trim() !== "") return declared.trim();
    const prop = (rec as { title?: unknown }).title;
    if (typeof prop === "string" && prop.trim() !== "") return prop.trim();

    const lines = (inner as { render?: (w: number) => string[] }).render?.(120);
    if (Array.isArray(lines)) {
      for (const l of lines) {
        if (typeof l !== "string") continue;
        const clean = l.replace(ANSI_RE_DLG, "").trim();
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

export function createFallbackTheme(): Theme {
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

let activeCtx: ExtensionContext | undefined;

export function setActiveContext(ctx?: ExtensionContext): void {
  activeCtx = ctx;
}

export function getActiveContext(): ExtensionContext | undefined {
  return activeCtx;
}

export function getSafeTheme(thisArg?: any): Theme {
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

/**
 * Clean selectable options list component with keyboard and mouse navigation
 * designed for seamless integration inside DcWindow.
 */
export class CleanExtensionSelectPanel implements Component {
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

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  setSelectedIndex(idx: number): void {
    this.selectedIndex = Math.max(0, Math.min(this.options.length - 1, idx));
    this.ensureCursorVisible();
    this.requestRender();
  }

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
    if (matchesKey(data, Key.escape) || data === "\x1b" || data === "escape" || data === Key.escape || data === "q" || data === "Q") {
      this.onCancel();
      return true;
    }
    if (matchesKey(data, Key.up) || data === "\x1b[A" || data === "up" || data === Key.up || data === "k") {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.ensureCursorVisible();
        this.requestRender();
      }
      return true;
    }
    if (matchesKey(data, Key.down) || data === "\x1b[B" || data === "down" || data === Key.down || data === "j") {
      if (this.selectedIndex < this.options.length - 1) {
        this.selectedIndex++;
        this.ensureCursorVisible();
        this.requestRender();
      }
      return true;
    }
    if (matchesKey(data, Key.pageUp) || data === "\x1b[5~" || data === "pageup" || data === Key.pageUp) {
      this.selectedIndex = Math.max(0, this.selectedIndex - this.maxVisible);
      this.ensureCursorVisible();
      this.requestRender();
      return true;
    }
    if (matchesKey(data, Key.pageDown) || data === "\x1b[6~" || data === "pagedown" || data === Key.pageDown) {
      this.selectedIndex = Math.min(this.options.length - 1, this.selectedIndex + this.maxVisible);
      this.ensureCursorVisible();
      this.requestRender();
      return true;
    }
    if (matchesKey(data, Key.home) || data === "\x1b[H" || data === "home" || data === Key.home) {
      this.selectedIndex = 0;
      this.ensureCursorVisible();
      this.requestRender();
      return true;
    }
    if (matchesKey(data, Key.end) || data === "\x1b[F" || data === "end" || data === Key.end) {
      this.selectedIndex = Math.max(0, this.options.length - 1);
      this.ensureCursorVisible();
      this.requestRender();
      return true;
    }
    if (matchesKey(data, Key.enter) || data === "\r" || data === "\n" || data === "enter" || data === Key.enter || data === " ") {
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
