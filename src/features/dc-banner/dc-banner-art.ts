import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const DC_LOGO = [
  "              ██████████████████████████████████████████████████              ",
  "            ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░████            ",
  "          ████░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░░░████          ",
  "        ████░▒▒▒▒▒████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒████▒▒▒░░░████        ",
  "      ████░▒▒▒▒▒████░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░░░████▒▒▒░░░████      ",
  "      ████▒▒▒▒▒░████▒▒▒▒▒▒▒▒▒▒██████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░████▒▒▒▒▒░████      ",
  "      ████▒▒▒▒▒░████▒▒▒▒▒▒▒▒▒░██░░░██▒▒▒▒▒██████▒▒▒▒▒▒▒▒▒░████▒▒▒▒▒░████      ",
  "      ████▒▒▒▒▒░████▒▒▒▒▒▒▒▒▒░██▒▒░░██▒▒▒██░░░░▒▒▒▒▒▒▒▒▒▒░████▒▒▒▒▒░████      ",
  "      ████▒▒▒▒▒░████▒▒▒▒▒▒▒▒▒░██▒▒▒░██▒▒░██▒▒▒▒▒▒▒▒▒▒▒▒▒▒░████▒▒▒▒▒░████      ",
  "      ████▒▒▒▒▒░████▒▒▒▒▒▒▒▒▒░██▒▒▒██▒▒▒░██▒▒▒▒▒▒▒▒▒▒▒▒▒▒░████▒▒▒▒▒░████      ",
  "    ████░▒▒▒▒▒████░▒▒▒▒▒▒▒▒▒▒░██████▒▒▒▒░░██████▒▒▒▒▒▒▒▒▒░░░████▒▒▒░░░████    ",
  "  ████░▒▒▒▒▒████░▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░▒▒▒▒▒▒░░░░░░▒▒▒▒▒▒▒▒▒▒▒▒░░░████▒▒▒░░░████  ",
  "  ████▒▒▒▒▒░████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░████▒▒▒▒▒░████  ",
  "    ████▒▒▒░░░████▒▒▒▒▒▒██████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒████░▒▒▒▒▒████    ",
  "      ████▒▒▒░░░████▒▒▒░██░░░██▒▒▒▒▒█████▒▒▒▒██▒▒▒▒▒▒██▒▒▒████░▒▒▒▒▒████      ",
  "      ████▒▒▒▒▒░████▒▒▒░██▒▒░░██▒▒▒██░░░██▒▒░░██▒▒▒▒██▒▒▒░████▒▒▒▒▒░████      ",
  "      ████▒▒▒▒▒░████▒▒▒░██▒▒▒░██▒▒░███████▒▒▒░░██▒▒██▒▒▒▒░████▒▒▒▒▒░████      ",
  "      ████▒▒▒▒▒░████▒▒▒░██▒▒▒██▒▒▒░██░░░░▒▒▒▒▒░░████▒▒▒▒▒░████▒▒▒▒▒░████      ",
  "      ████▒▒▒▒▒░████▒▒▒░██████▒▒▒▒░░█████▒▒▒▒▒▒░░██▒▒▒▒▒▒░████▒▒▒▒▒░████      ",
  "      ████▒▒▒▒▒░████▒▒▒░░░░░░▒▒▒▒▒▒░░░░░▒▒▒▒▒▒▒▒░░▒▒▒▒▒▒▒░████▒▒▒▒▒░████      ",
  "        ████▒▒▒░░░████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒████░▒▒▒▒▒████        ",
  "          ████▒▒▒░░░░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░▒▒▒▒▒████          ",
  "            ████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒████            ",
  "              █████████████████████████████████████████████████               ",
];

export const FULL_LOGO_WIDTH = Math.max(...DC_LOGO.map((l) => visibleWidth(l)));
export const COMPACT_ART = "✦ Dc Studio ✦";

export const BLOOD_TOP: [number, number, number] = [255, 51, 51]; // bloodBright #ff3333
export const BLOOD_BOTTOM: [number, number, number] = [153, 0, 0]; // bloodDeep #990000

export function rgbAnsi(r: number, g: number, b: number, text: string): string {
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

export function bloodShade(row: number, total: number): [number, number, number] {
  const t = total <= 1 ? 0 : row / (total - 1);
  return [
    lerp(BLOOD_TOP[0], BLOOD_BOTTOM[0], t),
    lerp(BLOOD_TOP[1], BLOOD_BOTTOM[1], t),
    lerp(BLOOD_TOP[2], BLOOD_BOTTOM[2], t),
  ];
}

/** Render the centered ASCII shield logo with the Blood red gradient. */
export function renderDcBanner(width: number, topPadRows: number = 8): string[] {
  const lines: string[] = [];
  // Espaciado superior vertical para centrar el logo visualmente en la pantalla
  for (let i = 0; i < topPadRows; i++) {
    lines.push("");
  }

  if (width < FULL_LOGO_WIDTH + 4) {
    const pad = " ".repeat(Math.max(0, Math.floor((width - visibleWidth(COMPACT_ART)) / 2)));
    lines.push(pad + rgbAnsi(BLOOD_TOP[0], BLOOD_TOP[1], BLOOD_TOP[2], COMPACT_ART));
    lines.push("");
    return lines;
  }

  for (let i = 0; i < DC_LOGO.length; i++) {
    const rawLine = DC_LOGO[i]!;
    const [r, g, b] = bloodShade(i, DC_LOGO.length);
    const painted = rgbAnsi(r, g, b, rawLine);
    const pad = " ".repeat(Math.max(0, Math.floor((width - FULL_LOGO_WIDTH) / 2)));
    lines.push(pad + painted);
  }
  lines.push("");
  return lines;
}
