import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

export type ProfileId = "dcdev" | "cubis";

export const BIG_DEFAULT: readonly string[] = [
  "   ~~~~~~~~~~~~~~~~~~~   ",
  "  /~~~~~~~~~~~~~~~~~~~\\  ",
  " |~~        ~        ~~| ",
  " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
  " │  ╔═════╗   ╔═════╗  │ ",
  " │══║  ♥  ║═══║  ♥  ║══│ ",
  " │  ╚═════╝   ╚═════╝  │ ",
  " │          ╩          │ ",
  "  \\                   /  ",
  "   \\    ╘═══════╛    /   ",
  "    \\     #####     /    ",
  "     └─────###─────┘     ",
];

export const CUBIS_DEFAULT: readonly string[] = [
  "┌─────────────────────┐",
  "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
  "│  ╔═════╗   ╔═════╗  │",
  "│  ║  ♥  ║   ║  ♥  ║  │",
  "│  ╚═════╝   ╚═════╝  │",
  "│          ╩          │",
  "│                     │",
  "│      ╘═══════╛      │",
  "│                     │",
  "└─────────────────────┘",
];

export function paintBigLine(line: string, fg: (color: string, text: string) => string): string {
  return Array.from(line)
    .map((ch, idx) => {
      let role = "border";
      const isOuter =
        ch === "/" ||
        ch === "\\" ||
        ch === "|" ||
        ch === " " ||
        (ch === "│" && (idx === 0 || idx === line.length - 1));
      if (isOuter) role = "error";
      else if ("~".includes(ch)) role = "text";
      else if ("▲".includes(ch)) role = "error";
      else if ("╔║╚╞╒╝╗╛╕╜╖".includes(ch)) role = "text";
      else if ("═".includes(ch) && line.includes("╔")) role = "text";
      else if ("♥".includes(ch)) role = "error";
      else if ("■♦≡".includes(ch)) role = "accent";
      else if ("╩‖".includes(ch)) role = "muted";
      else if ("╘╬╕╒«»═╝╗╛╜╖".includes(ch)) role = "text";
      else if ("#".includes(ch)) role = "error";
      else if ("zZ".includes(ch)) role = "muted";
      else if ("?!".includes(ch)) role = "warning";
      return fg(role, ch);
    })
    .join("");
}

export class ProfileDuel implements Component {
  selected: 0 | 1;
  onPick: ((p: ProfileId) => void) | null = null;
  onCancel: (() => void) | null = null;
  private lastColW = 0;
  private lastH = 0;

  constructor(
    private readonly theme: Pick<Theme, "fg" | "bg" | "bold">,
    current: ProfileId = "dcdev",
  ) {
    this.selected = current === "cubis" ? 1 : 0;
  }

  invalidate(): void {}

  private metrics(inner: number) {
    const colW = Math.max(20, Math.floor((inner - 3) / 2));
    const H = Math.max(BIG_DEFAULT.length, CUBIS_DEFAULT.length);
    return { colW, H };
  }

  private faceCell(
    lines: readonly string[],
    selected: boolean,
    colW: number,
    H: number,
  ): string[] {
    const fg = (color: string, text: string) => this.theme.fg(color as any, text);
    const w = Math.max(...lines.map((l) => visibleWidth(l)));
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
    const fg = (color: string, text: string) => this.theme.fg(color as any, text);
    const raw = `${selected ? "◉" : "○"} ${text}`;
    const styled = selected ? fg("accent", this.theme.bold(raw)) : fg("dim", raw);
    const lp = Math.floor((colW - visibleWidth(raw)) / 2);
    return (
      " ".repeat(Math.max(0, lp)) +
      styled +
      " ".repeat(Math.max(0, colW - lp - visibleWidth(raw)))
    );
  }

  render(width: number): string[] {
    const inner = width;
    const { colW, H } = this.metrics(inner);
    this.lastColW = colW;
    this.lastH = H;
    const fg = (color: string, text: string) => this.theme.fg(color as any, text);
    const left = this.faceCell(BIG_DEFAULT, this.selected === 0, colW, H);
    const right = this.faceCell(CUBIS_DEFAULT, this.selected === 1, colW, H);
    const div = fg("accent", "│");
    const emptyRow = `${" ".repeat(colW)} ${div} ${" ".repeat(colW)}`;
    const rows = left.map((l, i) => `${l} ${div} ${right[i]}`);
    return [
      emptyRow,
      ...rows,
      emptyRow,
      `${this.label("dcdev", this.selected === 0, colW)} ${div} ${this.label("cubis", this.selected === 1, colW)}`,
      emptyRow,
    ];
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, Key.left) || matchesKey(data, Key.up)) {
      this.selected = 0;
      return true;
    }
    if (matchesKey(data, Key.right) || matchesKey(data, Key.down)) {
      this.selected = 1;
      return true;
    }
    if (matchesKey(data, Key.enter) || data === " ") {
      this.pickCurrent();
      return true;
    }
    if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
      this.onCancel?.();
      return true;
    }
    return false;
  }

  pickCurrent(): void {
    this.onPick?.(this.selected === 1 ? "cubis" : "dcdev");
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel") return undefined;
    if (event.button !== "left" || (event.type !== "press" && event.type !== "click"))
      return undefined;

    // The face area spans from row 1 to 1 + H
    if (event.y < 1 || event.y > 1 + this.lastH + 2) return undefined;
    const side = event.x > this.lastColW + 1 ? 1 : 0;
    if (event.type === "press") {
      this.selected = side as 0 | 1;
      return { handled: true, render: true };
    }
    this.selected = side as 0 | 1;
    this.onPick?.(side === 1 ? "cubis" : "dcdev");
    return { handled: true };
  }
}
