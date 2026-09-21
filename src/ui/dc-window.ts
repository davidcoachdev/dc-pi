import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Key, matchesKey, truncateToWidth, visibleWidth,
  type Component, type TuiMouseEvent, type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

export type DcFrame = "single" | "double";
const FRAMES = {
  single: { tl: "┌", tr: "┐", bl: "└", br: "┘", ml: "├", mr: "┤", v: "│", h: "─" },
  double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", ml: "╠", mr: "╣", v: "║", h: "═" },
};

/** Standard solid dark coal background for DC Studio modals (#100a0d). */
export const MODAL_BG = "\x1b[48;2;16;10;13m";
export const MODAL_BG_RESET = "\x1b[49m";

/** Wraps text in a solid modal background, preserving intermediate ANSI resets. */
export function applyModalBg(text: string): string {
  const preserved = text
    .replace(/\x1b\[0m/g, `\x1b[0m${MODAL_BG}`)
    .replace(/\x1b\[49m/g, MODAL_BG);
  return `${MODAL_BG}${preserved}${MODAL_BG_RESET}`;
}

/** A component may return true from handleInput to consume Escape. */
export interface DcWindowContent extends Component {
  handleInput?(data: string): void | boolean;
  handleMouse?(event: TuiMouseEvent): TuiMouseEventResult | undefined;
}

export type DcWindowFooter =
  | string
  | { left: string; right?: string }
  | (() => string | { left: string; right?: string });

export interface DcWindowOptions {
  title: string | (() => string);
  glyph?: string;
  content: DcWindowContent;
  theme: Pick<Theme, "fg" | "bg" | "bold">;
  onClose: () => void;
  /** Optional callback fired when the user drags the title bar. */
  onMove?: (deltaX: number, deltaY: number) => void;
  footer?: DcWindowFooter;
  /** Optional callback fired when the right control in the footer is clicked. */
  onFooterRightClick?: () => void;
  paddingX?: number;
  titleBarBackground?: boolean;
  frame?: DcFrame;
  /** Total row budget, including chrome. Match the host overlay's allocation. */
  maxHeight?: number | (() => number);
  /** Whether body can be scrolled when content exceeds budget. Default true. */
  scrollable?: boolean;
  /** Whether to show a retro scrollbar on the right border when scrollable. Default true. */
  showScrollbar?: boolean;
  /** Whether to apply a solid opaque background so the terminal behind never shows. Default true. */
  solidBackground?: boolean;
}

function cells(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** Pad after truncation too: wide glyphs can leave a spare display cell. */
function cell(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/** Win 3.1-style chrome. Importing this module registers nothing with Pi. */
export class DcWindow implements Component {
  private readonly options: DcWindowOptions;
  private closeStart = -1;
  private closeEnd = -1;
  private bodyX = 0;
  private bodyWidth = 0;
  private bodyHeight = 0;
  private readonly bodyY = 3;
  private footerY = -1;
  private footerRightStart = -1;
  private footerRightEnd = -1;
  private lastWidth = 0;
  private scrollY = 0;
  private maxScroll = 0;
  private totalLines = 0;
  private bodyBudget = 0;
  private dragStartX = 0;
  private dragStartY = 0;
  private isDragging = false;

  constructor(options: DcWindowOptions) {
    this.options = options;
  }

  invalidate(): void {
    this.resetBounds();
    this.options.content.invalidate();
  }

  getScroll(): number {
    return this.scrollY;
  }

  getMaxScroll(): number {
    return this.maxScroll;
  }

  scrollTo(target: number): boolean {
    const clamped = Math.max(0, Math.min(target, this.maxScroll));
    if (clamped !== this.scrollY) {
      this.scrollY = clamped;
      return true;
    }
    return false;
  }

  scrollBy(delta: number): boolean {
    return this.scrollTo(this.scrollY + delta);
  }

  private resetBounds(): void {
    this.closeStart = this.closeEnd = -1;
    this.bodyWidth = this.bodyHeight = 0;
    this.footerY = this.footerRightStart = this.footerRightEnd = -1;
    this.isDragging = false;
  }

  private titleBar(inner: number): string {
    const { theme, title, glyph = "", titleBarBackground = true } = this.options;
    const text = typeof title === "function" ? title() : title;
    // Reserve the control before clipping the title, never clip a live hitbox.
    const label = inner >= 5 ? "[ X ]" : inner >= 3 ? "[X]" : inner >= 1 ? "X" : "";
    const trailing = inner >= 6 ? " " : "";
    const leftWidth = inner - label.length - trailing.length;
    const left = " " + (glyph ? theme.fg("accent", glyph) + " " : "") + theme.bold(theme.fg("text", text));
    const painted = cell(left, leftWidth) + theme.bold(theme.fg("error", label)) + trailing;
    if (label) {
      this.closeStart = 1 + leftWidth;
      this.closeEnd = this.closeStart + label.length;
    }
    return titleBarBackground ? theme.bg("selectedBg", painted) : painted;
  }

  render(width: number): string[] {
    this.resetBounds();
    width = cells(width);
    const { theme, footer, content, maxHeight, paddingX = 1, frame = "single" } = this.options;
    const footerText = typeof footer === "function" ? footer() : footer;
    const chromeRows = footerText === undefined ? 4 : 6;
    const budget = cells(typeof maxHeight === "function" ? maxHeight() :
      maxHeight ?? Math.max(8, Math.floor((process.stdout.rows ?? 40) * 0.84)));
    // Too little room for complete chrome: render nothing, retain keyboard close.
    if (width < 2 || budget < chromeRows) return [];

    const f = FRAMES[frame];
    const border = (text: string) => theme.fg("border", text);
    const inner = width - 2;
    const side = border(f.v);
    const rule = border(f.ml + f.h.repeat(inner) + f.mr);
    const lines = [border(f.tl + f.h.repeat(inner) + f.tr), side + this.titleBar(inner) + side, rule];
    this.lastWidth = width;
    const padX = Math.min(cells(paddingX), Math.max(0, Math.floor((inner - 1) / 2)));
    const bodyWidth = inner - padX * 2;
    const pad = " ".repeat(padX);
    const bodyBudget = budget - chromeRows;
    let bodyLines: string[] = [];
    if (bodyWidth > 0 && bodyBudget > 0) {
      // Preserve the original empty-body fallback, including failed child renders.
      try { bodyLines = content.render(bodyWidth); } catch { bodyLines = []; }
      if (bodyLines.length === 0) bodyLines = [""];
      this.totalLines = bodyLines.length;
      this.bodyBudget = bodyBudget;
      this.maxScroll = Math.max(0, this.totalLines - bodyBudget);
      this.scrollY = Math.max(0, Math.min(this.scrollY, this.maxScroll));

      bodyLines = this.options.scrollable !== false
        ? bodyLines.slice(this.scrollY, this.scrollY + bodyBudget)
        : bodyLines.slice(0, bodyBudget);
    } else {
      this.totalLines = 0;
      this.bodyBudget = 0;
      this.maxScroll = 0;
      this.scrollY = 0;
    }
    this.bodyX = 1 + padX;
    this.bodyWidth = bodyWidth;
    this.bodyHeight = bodyLines.length;

    const isScrollable = this.options.scrollable !== false &&
      this.options.showScrollbar !== false &&
      this.maxScroll > 0 &&
      this.bodyHeight >= 2;

    const padLeft = " ".repeat(padX);
    const padRight = " ".repeat(isScrollable ? Math.max(0, padX - 1) : padX);

    for (let i = 0; i < bodyLines.length; i++) {
      let scrollChar = "";
      if (isScrollable) {
        if (i === 0) {
          scrollChar = theme.fg(this.scrollY > 0 ? "accent" : "dim", "▲");
        } else if (i === bodyLines.length - 1) {
          scrollChar = theme.fg(this.scrollY < this.maxScroll ? "accent" : "dim", "▼");
        } else {
          const trackHeight = bodyLines.length - 2;
          const thumbRow = Math.min(trackHeight - 1, Math.round((this.scrollY / this.maxScroll) * (trackHeight - 1)));
          const isThumb = (i - 1) === thumbRow;
          scrollChar = isThumb ? theme.fg("accent", "█") : theme.fg("dim", "░");
        }
      }
      lines.push(side + padLeft + cell(bodyLines[i], bodyWidth) + padRight + scrollChar + side);
    }
    let footerLine: string | undefined;
    if (footer !== undefined) {
      const resolved = typeof footer === "function" ? footer() : footer;
      if (typeof resolved === "string") {
        footerLine = cell(" " + resolved, inner);
      } else if (resolved && typeof resolved === "object") {
        const left = resolved.left ?? "";
        const right = resolved.right ?? "";
        const leftW = visibleWidth(left);
        const rightW = visibleWidth(right);
        const gap = Math.max(1, inner - leftW - rightW);
        if (rightW > 0) {
          this.footerRightStart = 1 + leftW + gap;
          this.footerRightEnd = this.footerRightStart + rightW;
        }
        footerLine = cell(left + " ".repeat(gap) + right, inner);
      }
    }

    if (footerLine !== undefined) {
      lines.push(rule, side + footerLine + side);
      this.footerY = lines.length - 1; // 0-based index of footer line in lines
    }
    lines.push(border(f.bl + f.h.repeat(inner) + f.br));

    const solidBg = this.options.solidBackground !== false;
    return solidBg ? lines.map(applyModalBg) : lines;
  }

  handleInput(data: string): boolean {
    if (this.options.content.handleInput?.(data) === true) return true;
    if (matchesKey(data, Key.escape)) {
      this.options.onClose();
      return true;
    }
    if (this.options.scrollable !== false && this.maxScroll > 0) {
      if (matchesKey(data, Key.up)) {
        return this.scrollBy(-1);
      }
      if (matchesKey(data, Key.down)) {
        return this.scrollBy(1);
      }
      if (matchesKey(data, Key.pageUp)) {
        return this.scrollBy(-Math.max(1, this.bodyBudget - 1));
      }
      if (matchesKey(data, Key.pageDown)) {
        return this.scrollBy(Math.max(1, this.bodyBudget - 1));
      }
      if (matchesKey(data, Key.home)) {
        return this.scrollTo(0);
      }
      if (matchesKey(data, Key.end)) {
        return this.scrollTo(this.maxScroll);
      }
    }
    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const { x, y, type, button } = event;
    if (type === "click" && button === "left" && y === 1 &&
        this.closeStart >= 0 && x >= this.closeStart && x < this.closeEnd) {
      this.options.onClose();
      return { handled: true };
    }

    // Footer right button click
    if (this.options.onFooterRightClick && y === this.footerY &&
        this.footerRightStart >= 0 && x >= this.footerRightStart && x < this.footerRightEnd) {
      if (type === "click" && button === "left") {
        this.options.onFooterRightClick();
        return { handled: true };
      }
    }

    // Title bar drag start
    if (this.options.onMove && y === 1 && (this.closeStart < 0 || x < this.closeStart || x >= this.closeEnd)) {
      if (type === "press" && button === "left") {
        this.isDragging = true;
        this.dragStartX = event.screenX;
        this.dragStartY = event.screenY;
        return { handled: true, capture: true };
      }
    }

    // Active drag handling
    if (this.isDragging) {
      if (type === "drag") {
        const deltaX = event.screenX - this.dragStartX;
        const deltaY = event.screenY - this.dragStartY;
        this.dragStartX = event.screenX;
        this.dragStartY = event.screenY;
        if (deltaX !== 0 || deltaY !== 0) {
          this.options.onMove?.(deltaX, deltaY);
          return { handled: true, render: true };
        }
        return { handled: true };
      }
      if (type === "release") {
        this.isDragging = false;
        return { handled: true, render: true };
      }
    }

    // Scrollbar click inside right margin (or right border)
    if (this.options.scrollable !== false && this.options.showScrollbar !== false &&
        this.maxScroll > 0 && this.bodyHeight >= 2 &&
        (x === this.lastWidth - 2 || x === this.lastWidth - 1) &&
        y >= this.bodyY && y < this.bodyY + this.bodyHeight) {
      if (type === "click" && button === "left") {
        const bodyRow = y - this.bodyY;
        if (bodyRow === 0) {
          if (this.scrollBy(-1)) return { handled: true, render: true };
          return { handled: true };
        } else if (bodyRow === this.bodyHeight - 1) {
          if (this.scrollBy(1)) return { handled: true, render: true };
          return { handled: true };
        } else {
          const trackHeight = this.bodyHeight - 2;
          const thumbRow = 1 + Math.min(trackHeight - 1, Math.round((this.scrollY / this.maxScroll) * (trackHeight - 1)));
          const dir = bodyRow < thumbRow ? -1 : 1;
          const pageSize = Math.max(1, this.bodyBudget - 1);
          if (this.scrollBy(dir * pageSize)) return { handled: true, render: true };
          return { handled: true };
        }
      }
    }

    if (x >= this.bodyX && x < this.bodyX + this.bodyWidth &&
        y >= this.bodyY && y < this.bodyY + this.bodyHeight) {
      const childResult = this.options.content.handleMouse?.({
        ...event, x: x - this.bodyX, y: y - this.bodyY + this.scrollY,
        width: this.bodyWidth, height: this.bodyHeight,
      });
      if (childResult?.handled) return childResult;
    }

    // Mouse wheel anywhere on the window (if child didn't consume it)
    if (type === "wheel" && this.options.scrollable !== false && this.maxScroll > 0) {
      const delta = event.wheelDelta ?? 3;
      if (this.scrollBy(delta)) {
        return { handled: true, render: true };
      }
      return { handled: true };
    }

    return undefined;
  }
}
