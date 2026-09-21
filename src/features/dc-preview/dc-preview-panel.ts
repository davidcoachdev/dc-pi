import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface DcPreviewSelectItem {
  value: string;
  label: string;
  description?: string;
}

export class DcPreviewSelectPanel implements Component {
  private selectedIndex = 0;
  private scrollOffset = 0;

  constructor(
    private readonly items: DcPreviewSelectItem[],
    private readonly theme: Theme,
    private readonly onSelect: (val: string) => void,
    private readonly onCancel: () => void,
    private readonly requestRender: () => void,
  ) {}

  invalidate(): void {}

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  setSelectedIndex(idx: number): void {
    this.selectedIndex = Math.max(0, Math.min(this.items.length - 1, idx));
    this.ensureCursorVisible();
    this.requestRender();
  }

  private ensureCursorVisible(): void {
    this.selectedIndex = Math.max(0, Math.min(this.items.length - 1, this.selectedIndex));
    const maxOff = Math.max(0, this.items.length - 8);
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + 8) {
      this.scrollOffset = Math.max(0, this.selectedIndex - 8 + 1);
    }
    this.scrollOffset = Math.max(0, Math.min(maxOff, this.scrollOffset));
  }

  render(width: number): string[] {
    const t = this.theme;
    const innerW = Math.max(20, width);
    this.ensureCursorVisible();

    const pad = (s: string, len: number) => {
      const v = visibleWidth(s);
      return v >= len ? truncateToWidth(s, len, "") : s + " ".repeat(len - v);
    };

    const visible = this.items.slice(this.scrollOffset, this.scrollOffset + 8);
    const out: string[] = [];

    for (let i = 0; i < visible.length; i++) {
      const itemIdx = this.scrollOffset + i;
      const item = visible[i]!;
      const isSelected = itemIdx === this.selectedIndex;

      const bullet = isSelected ? t.fg("accent", "●") : t.fg("dim", "○");
      const label = item.label;
      const desc = item.description ? t.fg("muted", ` (${item.description})`) : "";
      const rawRow = ` ${bullet} ${label}${desc}`;
      const paddedRow = pad(rawRow, innerW);

      if (isSelected) {
        out.push(t.bg("selectedBg", t.bold(paddedRow)));
      } else {
        out.push(t.fg("text", paddedRow));
      }
    }

    return out;
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
      this.onCancel();
      return true;
    }

    if (matchesKey(data, Key.up)) {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.ensureCursorVisible();
        this.requestRender();
      }
      return true;
    }

    if (matchesKey(data, Key.down)) {
      if (this.selectedIndex < this.items.length - 1) {
        this.selectedIndex++;
        this.ensureCursorVisible();
        this.requestRender();
      }
      return true;
    }

    if (matchesKey(data, Key.enter) || data === " ") {
      const item = this.items[this.selectedIndex];
      if (item) this.onSelect(item.value);
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
        this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
      } else {
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      }
      this.ensureCursorVisible();
      this.requestRender();
      return { handled: true };
    }

    if (type === "click" && (event as { button?: string }).button !== "right") {
      const clickedIdx = this.scrollOffset + y;
      if (clickedIdx >= 0 && clickedIdx < this.items.length) {
        if (this.selectedIndex === clickedIdx) {
          const item = this.items[clickedIdx];
          if (item) this.onSelect(item.value);
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
