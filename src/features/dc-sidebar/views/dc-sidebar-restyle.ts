import type { TUI } from "@earendil-works/pi-tui";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import { getTheme, coloredFrame } from "./dc-sidebar-header.ts";
import { DOUBLE_FRAME } from "../../../ui/dc-sidebar-card.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function withCardGlyph(text: string): string {
  if (text.includes("Todo") || text.includes("Todos") || text.includes("task")) {
    return text.includes("🧰") ? text : `🧰 ${text}`;
  }
  if (text.includes("Agent") || text.includes("Agents") || text.includes("subagent")) {
    return text.includes("👨‍💼") ? text : `👨‍💼 ${text}`;
  }
  return text;
}

/**
 * Convierte un card con bordes redondeados (como los widgets de gentle-pi)
 * en una caja con estética DcWindow (marco doble ╔═╗║╚═╝ y cabecera roja DC).
 */
export function restyleCard(tui: TUI | undefined, lines: string[], width: number): string[] {
  if (!lines || lines.length < 3) return lines;
  const inner = Math.max(0, width - 2);
  const theme = getTheme();
  const b = (s: string) => coloredFrame(tui, s);
  const visOf = (s: string) => s.replace(ANSI_RE, "");

  const topIdx = lines.findIndex((l) => /[╭┌╔]/.test(visOf(l)));
  let botIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/[╰└╚]/.test(visOf(lines[i] || ""))) {
      botIdx = i;
      break;
    }
  }

  if (topIdx < 0 || botIdx <= topIdx) return lines;

  const rawTitle = visOf(lines[topIdx] || "")
    .replace(/[╭╮╰╯┌┐└┘─═│║]/g, "")
    .trim() || "Card";
  const title = withCardGlyph(rawTitle);

  const topLine = b(DOUBLE_FRAME.tl + DOUBLE_FRAME.h.repeat(inner) + DOUBLE_FRAME.tr);
  const ruleLine = b(DOUBLE_FRAME.ml + DOUBLE_FRAME.h.repeat(inner) + DOUBLE_FRAME.mr);
  const botLine = b(DOUBLE_FRAME.bl + DOUBLE_FRAME.h.repeat(inner) + DOUBLE_FRAME.br);

  // Formatear título centrado o justificado
  const styledTitle = ` \x1b[1m\x1b[38;2;255;51;51m${title}\x1b[0m `;
  const vTitle = visibleWidth(styledTitle);
  const padLeft = Math.max(0, Math.floor((inner - vTitle) / 2));
  const padRight = Math.max(0, inner - vTitle - padLeft);
  const titleLine =
    b(DOUBLE_FRAME.v) +
    " ".repeat(padLeft) +
    styledTitle +
    " ".repeat(padRight) +
    b(DOUBLE_FRAME.v);

  const bodyLines: string[] = [];
  for (let i = topIdx + 1; i < botIdx; i++) {
    const raw = lines[i] || "";
    // Limpiar bordes viejos verticales
    let content = visOf(raw).trim();
    if (content.startsWith("│") || content.startsWith("║")) {
      content = content.slice(1);
    }
    if (content.endsWith("│") || content.endsWith("║")) {
      content = content.slice(0, -1);
    }
    content = content.trim();

    const vContent = visibleWidth(content);
    const clipped = vContent > inner - 2 ? truncateToWidth(content, inner - 2, "…") : content;
    const vClipped = visibleWidth(clipped);
    const linePad = Math.max(0, inner - 2 - vClipped);

    bodyLines.push(
      b(DOUBLE_FRAME.v) + " " + clipped + " ".repeat(linePad + 1) + b(DOUBLE_FRAME.v)
    );
  }

  const result: string[] = [];
  // Preservar líneas anteriores si las hubiera
  for (let i = 0; i < topIdx; i++) {
    result.push(lines[i] || "");
  }

  result.push(topLine, titleLine, ruleLine, ...bodyLines, botLine);

  // Preservar líneas posteriores si las hubiera
  for (let i = botIdx + 1; i < lines.length; i++) {
    result.push(lines[i] || "");
  }

  return result;
}
