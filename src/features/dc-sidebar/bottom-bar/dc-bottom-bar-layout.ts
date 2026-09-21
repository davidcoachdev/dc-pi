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
 *
 * Mapeo idéntico al original:
 * [1. Brand] ⟡ [2. Location & Git] ⟡ [3. Session & Status] ⟡ [4. Face]
 */
export function renderBottomBar(boxes: BottomBarBoxes, width: number): string {
  if (width <= 0) return "";

  const padMargin = width >= 100 ? 2 : width >= 60 ? 1 : 0;
  const avail = Math.max(10, width - padMargin * 2);

  const brand = (boxes.brand || BRAND_TEXT).trim();
  const location = (boxes.location || "").trim();
  const session = (boxes.session || "").trim();
  const face = (boxes.face || "").trim();

  // Escalera de candidatos responsiva (4 cajas -> 3 cajas -> 2 cajas -> 1 caja):
  const candidates: string[][] = [];

  // Candidato 1: 4 cajas completas [Brand] ⟡ [Location] ⟡ [Session] ⟡ [Face]
  if (location && session && face) {
    candidates.push([brand, location, session, face]);
  }

  // Candidato 2: 3 cajas (cede session) [Brand] ⟡ [Location] ⟡ [Face]
  if (location && face) {
    candidates.push([brand, location, face]);
  }

  // Candidato 3: 3 cajas (si no hay location pero hay session) [Brand] ⟡ [Session] ⟡ [Face]
  if (session && face) {
    candidates.push([brand, session, face]);
  }

  // Candidato 4: 2 cajas [Brand] ⟡ [Face] (la carita y la marca son lo último en ocultarse)
  if (face) {
    candidates.push([brand, face]);
  }

  // Candidato 5: Solo Brand
  candidates.push([brand]);

  for (const cand of candidates) {
    const n = cand.length;

    // Elemento único
    if (n === 1) {
      const w0 = visibleWidth(cand[0]!);
      if (w0 <= avail) {
        return `${" ".repeat(padMargin)}${cand[0]}${" ".repeat(avail - w0)}${" ".repeat(padMargin)}`;
      }
      return truncateToWidth(cand[0]!, width, "…");
    }

    const sumW = cand.reduce((acc, item) => acc + visibleWidth(item), 0);
    const numGaps = n - 1;
    const minNeeded = sumW + numGaps * 3; // mínimo " ⟡ " para cada separación

    if (minNeeded > avail) {
      continue; // no entra en este nivel de ancho, probar siguiente candidato
    }

    // Distribuir el espacio restante de forma equitativa entre los separadores ⟡
    const totalSpaces = avail - sumW - numGaps; // 1 columna reservada para ⟡
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
