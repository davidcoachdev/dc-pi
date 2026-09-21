import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import {
  BAR_SEPARATOR,
  BRAND_TEXT,
  extractBottomBarBoxes,
  type BottomBarBoxes,
} from "./dc-bottom-bar-boxes.ts";

export interface BottomBarLayoutOptions {
  padMargin?: number;
}

/**
 * Distributes boxes across the full terminal width with responsive degradation
 * and evenly distributed ⟡ separators.
 */
export function renderBottomBar(boxes: BottomBarBoxes, width: number): string {
  if (width <= 0) return "";

  const padMargin = width >= 100 ? 2 : width >= 60 ? 1 : 0;
  const avail = Math.max(10, width - padMargin * 2);

  const left = boxes.left.trim();
  const center = boxes.center.trim();
  const right = boxes.right.trim();

  // Progressive degradation candidates (3 boxes -> 2 boxes -> 1 box):
  const candidates: string[][] = [];

  // Candidate 1: Left + Center + Right (if center is available)
  if (center.length > 0 && right.length > 0) {
    candidates.push([left, center, right]);
  }

  // Candidate 2: Left + Right (drops Center)
  if (right.length > 0) {
    candidates.push([left, right]);
  }

  // Candidate 3: Left only
  candidates.push([left]);

  // Candidate 4: Brand only
  if (left !== BRAND_TEXT) {
    candidates.push([BRAND_TEXT]);
  }

  for (const cand of candidates) {
    const n = cand.length;

    // Single item fallback
    if (n === 1) {
      const w0 = visibleWidth(cand[0]!);
      if (w0 <= avail) {
        return `${" ".repeat(padMargin)}${cand[0]}${" ".repeat(avail - w0)}${" ".repeat(padMargin)}`;
      }
      return truncateToWidth(cand[0]!, width, "…");
    }

    const sumW = cand.reduce((acc, item) => acc + visibleWidth(item), 0);
    const numGaps = n - 1;
    const minNeeded = sumW + numGaps * 3; // minimum " ⟡ " for each gap

    if (minNeeded > avail) {
      continue; // does not fit at this level, try next candidate
    }

    // Distribute remaining spaces evenly across the ⟡ gaps
    const totalSpaces = avail - sumW - numGaps; // 1 column reserved for ⟡
    const baseSpaces = Math.floor(totalSpaces / numGaps);
    const remSpaces = totalSpaces % numGaps;

    let out = " ".repeat(padMargin);
    for (let i = 0; i < n; i++) {
      out += cand[i]!;
      if (i < numGaps) {
        const gapSpaces = baseSpaces + (i < remSpaces ? 1 : 0);
        const spLeft = Math.floor(gapSpaces / 2);
        const spRight = gapSpaces - spLeft;
        out += " ".repeat(spLeft) + "\x1b[2m" + BAR_SEPARATOR + "\x1b[22m" + " ".repeat(spRight);
      }
    }
    out += " ".repeat(padMargin);
    return out;
  }

  return truncateToWidth(BRAND_TEXT, width, "…");
}

/**
 * High-level pipeline taking a raw gentle-pi line and formatting it into the DC bottom bar.
 */
export function processBottomBar(
  rawLine: string,
  width: number,
  theme?: { fg: (color: string, text: string) => string },
): string {
  try {
    const boxes = extractBottomBarBoxes(rawLine, theme);
    return renderBottomBar(boxes, width);
  } catch {
    return rawLine;
  }
}
