import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

export interface DcTabItem {
  id: string;
  label: string;
  badge?: string;
  badgeType?: "warning" | "error" | "accent" | "dim";
}

export interface DcTabsOptions {
  theme?: Pick<Theme, "fg" | "bg" | "bold">;
  tabs: DcTabItem[];
  activeId: string;
  fullWidthBorder?: boolean;
  paddingX?: number;
  separator?: string;
  onSelect?: (id: string, index: number) => void;
}

export interface TabHitBound {
  id: string;
  index: number;
  startX: number;
  endX: number;
}

/**
 * Componente UI puro y reutilizable de pestañas horizontales (DcTabs)
 * con selección visual en selectedBg, badges dinámicos, separadores y
 * soporte de clics por coordenadas X.
 */
export class DcTabs implements Component {
  public options: DcTabsOptions;
  private hitBounds: TabHitBound[] = [];

  constructor(options: DcTabsOptions) {
    this.options = options;
  }

  invalidate(): void {}

  getActiveId(): string {
    return this.options.activeId;
  }

  setActiveId(id: string): void {
    if (this.options.activeId !== id) {
      this.options.activeId = id;
      const idx = this.options.tabs.findIndex((t) => t.id === id);
      if (idx >= 0) {
        this.options.onSelect?.(id, idx);
      }
    }
  }

  nextTab(): void {
    const { tabs, activeId } = this.options;
    if (tabs.length <= 1) return;
    const currentIdx = tabs.findIndex((t) => t.id === activeId);
    const nextIdx = (currentIdx + 1) % tabs.length;
    const nextId = tabs[nextIdx]!.id;
    this.setActiveId(nextId);
  }

  prevTab(): void {
    const { tabs, activeId } = this.options;
    if (tabs.length <= 1) return;
    const currentIdx = tabs.findIndex((t) => t.id === activeId);
    const prevIdx = (currentIdx - 1 + tabs.length) % tabs.length;
    const prevId = tabs[prevIdx]!.id;
    this.setActiveId(prevId);
  }

  render(width: number): string[] {
    const t = this.options.theme ?? {
      fg: (_col: string, s: string) => s,
      bg: (col: string, s: string) => (col === "selectedBg" ? `\x1b[48;2;40;20;25m${s}\x1b[49m` : s),
      bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
    };

    const safeW = Math.max(20, width);
    const padX = this.options.paddingX ?? 2;
    const padStr = " ".repeat(padX);
    const sepStr = this.options.separator ?? " │ ";
    const sepW = visibleWidth(sepStr);

    this.hitBounds = [];
    let currentX = padX;
    const tabParts: string[] = [];

    for (let i = 0; i < this.options.tabs.length; i++) {
      const tab = this.options.tabs[i]!;
      const isSelected = tab.id === this.options.activeId;

      let badgeStr = "";
      if (tab.badge) {
        const badgeColor = tab.badgeType ?? (isSelected ? "accent" : "dim");
        badgeStr = ` ${t.fg(badgeColor as any, tab.badge)}`;
      }

      const labelText = ` ${tab.label}${badgeStr} `;
      const labelW = visibleWidth(labelText);

      this.hitBounds.push({
        id: tab.id,
        index: i,
        startX: currentX,
        endX: currentX + labelW,
      });
      currentX += labelW;

      if (isSelected) {
        tabParts.push(t.bg("selectedBg", t.bold(t.fg("accent", labelText))));
      } else {
        tabParts.push(t.fg("dim", labelText));
      }

      if (i < this.options.tabs.length - 1) {
        tabParts.push(t.fg("dim", sepStr));
        currentX += sepW;
      }
    }

    const tabsLine = padStr + tabParts.join("");
    const borderW = this.options.fullWidthBorder !== false ? safeW : Math.max(0, safeW - padX * 2);
    const borderPad = this.options.fullWidthBorder !== false ? "" : padStr;
    const borderLine = borderPad + t.fg("border", "─".repeat(borderW));

    return [
      truncateToWidth(tabsLine, safeW, ""),
      truncateToWidth(borderLine, safeW, ""),
    ];
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "click" && event.button === "left") {
      // Row 0 es la fila de tabs
      if (event.y === 0) {
        for (const bound of this.hitBounds) {
          if (event.x >= bound.startX && event.x <= bound.endX) {
            this.setActiveId(bound.id);
            return { handled: true, render: true };
          }
        }
      }
    }
    return undefined;
  }
}
