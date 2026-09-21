import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";

export interface KaomojiItem {
  face: string;
  mood: string;
}

export const CARITAS: KaomojiItem[] = [
  // dc-face
  { face: "≧( ❂‿❂ )≦", mood: "feliz" },
  { face: "( ≖.≖ )", mood: "pensando" },
  { face: "m(◔◡◔)m", mood: "escribiendo" },
  { face: "^( '-' )^", mood: "trabajando" },
  { face: "( -_- ) z Z Z", mood: "dormido" },
  { face: "( ◐.◐ )", mood: "compactando" },
  { face: "( ʘ‿ʘ )", mood: "reintentando" },
  { face: "( ʘoʘ )", mood: "hablando" },
  { face: "( ◐‿◐ )!", mood: "permiso" },
  { face: "( ◐‿◐ )?", mood: "pregunta" },
  // clásicas
  { face: "¯\\_(ツ)_/¯", mood: "meh" },
  { face: "( ͡° ͜ʖ ͡°)", mood: "lenny" },
  { face: "ʕ•ᴥ•ʔ", mood: "osito" },
  { face: "(╯°□°）╯", mood: "flip" },
  { face: "(¬‿¬)", mood: "cómplice" },
  { face: "(◕‿◕)", mood: "contento" },
  { face: "(＾▽＾)", mood: "alegre" },
  { face: "(//∇//)", mood: "sonrojado" },
  { face: "(¬_¬)", mood: "sospecha" },
  { face: "(づ｡◕‿‿◕｡)づ", mood: "abrazo" },
];

export const CARITAS_ROWS_PAGE = 10;

export interface CaritasItem {
  value: string;
  label: string;
  description: string;
}

export class CaritasPanel implements Component {
  private selectedIndex = 0;
  private scrollOffset = 0;
  private lastWidth = 0;
  private lastRows = 0;

  constructor(
    private readonly items: CaritasItem[],
    private readonly theme: Pick<Theme, "fg" | "bg" | "bold">,
    private readonly onSelect: (val: string) => void,
    private readonly onCancel: () => void,
    private readonly requestRender: () => void,
  ) {}

  invalidate(): void {}

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  setSelectedIndex(index: number): void {
    this.selectedIndex = Math.max(0, Math.min(this.items.length - 1, index));
    this.ensureCursorVisible();
  }

  private ensureCursorVisible(): void {
    this.selectedIndex = Math.max(0, Math.min(this.items.length - 1, this.selectedIndex));
    const maxOff = Math.max(0, this.items.length - CARITAS_ROWS_PAGE);
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + CARITAS_ROWS_PAGE) {
      this.scrollOffset = Math.max(0, this.selectedIndex - CARITAS_ROWS_PAGE + 1);
    }
    this.scrollOffset = Math.max(0, Math.min(maxOff, this.scrollOffset));
  }

  render(width: number): string[] {
    const t = this.theme;
    const innerW = Math.max(20, width);
    this.lastWidth = innerW;
    this.lastRows = this.items.length;

    const pad = (s: string, len: number) => {
      const v = visibleWidth(s);
      return v >= len ? truncateToWidth(s, len, "") : s + " ".repeat(len - v);
    };

    return this.items.map((item, idx) => {
      const isSelected = idx === this.selectedIndex;
      const bullet = isSelected ? t.fg("accent", "●") : t.fg("dim", "○");
      const face = pad(item.label, 18);
      const mood = t.fg("muted", `[${item.description}]`);
      const rawRow = ` ${bullet} ${face} ${mood}`;
      const paddedRow = pad(rawRow, innerW);

      return isSelected
        ? t.bg("selectedBg", t.bold(paddedRow))
        : t.fg("text", paddedRow);
    });
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
    if (matchesKey(data, Key.pageUp)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - CARITAS_ROWS_PAGE);
      this.ensureCursorVisible();
      this.requestRender();
      return true;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + CARITAS_ROWS_PAGE);
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
      this.selectedIndex = Math.max(0, this.items.length - 1);
      this.ensureCursorVisible();
      this.requestRender();
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
    const delta = event.wheelDelta ?? 0;
    const y = event.y ?? 0;

    // Wheel: navigate item by item
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

    // Click: select row; second click on already-selected row applies
    if (type === "click" && event.button !== "right") {
      const clickedIdx = y;
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
