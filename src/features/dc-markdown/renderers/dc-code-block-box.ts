import { Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getLangIcon, resolveColors, strWidth } from "../core/dc-markdown-tokens.ts";
import { codeBlockCollapseState, queueRenderedBlock, storeCodeBlock } from "../core/dc-markdown-store.ts";

export interface CodeBlockBoxOptions {
  text: string;
  lang?: string;
  width: number;
  indent: string;
  isErrorBox?: boolean;
  activeUiTheme?: any;
  highlightCode?: (code: string, lang?: string) => string[];
  codeBlockThemeFn?: (line: string) => string;
}

/**
 * Renderiza un bloque de código completo como una card redondeada de DC Studio:
 * - Cabecera con icono Nerd Font, lenguaje y flechita [ ▲ ] / [ ▼ ].
 * - Cuerpo con fondo sutil 24-bit y código (o vista colapsada a 3 líneas).
 * - Borde inferior con botón interactivo [ 📋 ].
 * - Marcadores APC invisibles para asociación de clic O(1).
 */
export function renderCodeBlockBox(options: CodeBlockBoxOptions): string[] {
  const { text, width, indent, highlightCode, codeBlockThemeFn } = options;
  const rawLang = (options.lang || "").trim().toLowerCase();
  const isErrorBox = options.isErrorBox ?? (rawLang === "error" || rawLang === "err");

  const marginW = width > 40 ? 1 : 0;
  const blockW = Math.max(8, width - marginW * 2);
  const leftMargin = " ".repeat(marginW);
  const rightMargin = leftMargin;
  const innerCodeW = Math.max(4, blockW - 4);

  const codeId = storeCodeBlock(text || "", rawLang);
  queueRenderedBlock(codeId);
  const isCollapsed = codeBlockCollapseState.get(codeId) ?? false;
  const isMarkdown = rawLang === "markdown" || rawLang === "md";

  const { bgAnsi: CODE_BG, borderAnsi: borderCol, tagAnsi } = resolveColors(isErrorBox, options.activeUiTheme);
  const border = (s: string) => `${borderCol}${s}\x1b[0m`;
  const sideBorder = border("│");

  const styleBlockLine = (content: string): string => {
    const v = visibleWidth(content);
    const textCell =
      v > innerCodeW ? truncateToWidth(content, innerCodeW, "") : content + " ".repeat(Math.max(0, innerCodeW - v));
    const row = `${sideBorder} ${textCell} ${sideBorder}`;
    const pres = row.replace(/\x1b\[0m/g, `\x1b[0m${CODE_BG}`).replace(/\x1b\[49m/g, CODE_BG);
    return `${leftMargin}${CODE_BG}${pres}\x1b[49m${rightMargin}`;
  };

  let titlePart = "";
  if (isErrorBox) {
    titlePart = " ☠️ Error ";
  } else if (isMarkdown) {
    titlePart = " markdown ";
  } else if (rawLang && rawLang !== "text" && rawLang !== "txt") {
    titlePart = ` ${rawLang} `;
  } else {
    titlePart = " code ";
  }

  const titleLen = visibleWidth(titlePart);
  const arrowBadge = isCollapsed ? " ▼ " : " ▲ ";
  const arrowLen = visibleWidth(arrowBadge);
  const rightDashes = 3;
  const fillLen = Math.max(0, blockW - 3 - titleLen - arrowLen - rightDashes);

  const styledBadge = titlePart
    ? isErrorBox
      ? `\x1b[1m\x1b[38;2;255;80;80m${titlePart}\x1b[0m`
      : `\x1b[1m${tagAnsi}${titlePart}\x1b[0m`
    : "";

  const styledArrow = `\x1b[38;2;255;255;255m${arrowBadge}\x1b[0m`;
  const topBorder = `${borderCol}╭─${styledBadge}${borderCol}${"─".repeat(fillLen)}${styledArrow}${borderCol}${"─".repeat(rightDashes)}╮\x1b[0m`;

  const topRow = `${leftMargin}${CODE_BG}${topBorder.replace(/\x1b\[0m/g, `\x1b[0m${CODE_BG}`)}\x1b[49m${rightMargin}`;

  const copyBadge = " 📋 ";
  const copyBadgeLen = visibleWidth(copyBadge);
  const bottomDashes = Math.max(0, blockW - 2 - copyBadgeLen - rightDashes);
  const whiteCopy = `\x1b[38;2;255;255;255m${copyBadge}\x1b[0m`;
  const bottomBorder = `${borderCol}╰${"─".repeat(bottomDashes)}${whiteCopy}${borderCol}${"─".repeat(rightDashes)}╯\x1b[0m`;
  const bottomRow = `${leftMargin}${CODE_BG}${bottomBorder.replace(/\x1b\[0m/g, `\x1b[0m${CODE_BG}`)}\x1b[49m${rightMargin}`;

  const lines: string[] = [];
  lines.push(topRow);

  // Si es Markdown (lang: "markdown" | "md"), renderizarlo como contenido tipográfico formateado
  // (títulos enriquecidos sin '#' y viñetas con '•' en vez de '-')
  if (isMarkdown) {
    const fallbackMdTheme = {
      heading: (s: string) => `\x1b[1m\x1b[38;2;255;77;77m${s}\x1b[0m`,
      bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
      italic: (s: string) => `\x1b[3m${s}\x1b[23m`,
      underline: (s: string) => `\x1b[4m${s}\x1b[24m`,
      listBullet: (s: string) => `\x1b[38;2;255;77;77m•\x1b[0m `,
      code: (s: string) => `\x1b[38;2;255;204;102m${s}\x1b[0m`,
      codeBlock: (s: string) => s,
      codeBlockBorder: (s: string) => s,
      quote: (s: string) => s,
      quoteBorder: (s: string) => s,
      hr: (s: string) => s,
      link: (s: string) => s,
      linkUrl: (s: string) => s,
      strikethrough: (s: string) => s,
      codeBlockIndent: "  ",
    };
    const activeTheme = options.activeUiTheme;
    const mdTheme = activeTheme?.markdownTheme || activeTheme || fallbackMdTheme;

    const md = new Markdown(text || "", 0, 0, mdTheme);
    const mdLines = md.render(innerCodeW);

    if (isCollapsed) {
      const previewCount = Math.min(3, mdLines.length);
      for (let idx = 0; idx < previewCount; idx++) {
        lines.push(styleBlockLine(mdLines[idx] || ""));
      }
      if (mdLines.length > 3) {
        lines.push(
          styleBlockLine(
            `\x1b[2m… (${mdLines.length - 3} líneas más · clic arriba en ▼ para expandir)\x1b[22m`,
          ),
        );
      }
    } else {
      for (const line of mdLines) {
        lines.push(styleBlockLine(line));
      }
    }

    lines.push(bottomRow);
    return lines;
  }

  const rawCodeLines = (text || "").split("\n");
  const totalCodeLines = rawCodeLines.length;
  const gutterDigits = Math.max(1, String(totalCodeLines).length);

  const renderFormattedLine = (lineContent: string, lineIndex: number): string => {
    if (isErrorBox || isMarkdown) {
      return styleBlockLine(`${indent}${lineContent}`);
    }
    const numStr = String(lineIndex + 1).padStart(gutterDigits, " ");
    const gutter = `\x1b[2m${numStr} │\x1b[22m `;
    return styleBlockLine(` ${gutter}${lineContent}`);
  };

  if (isCollapsed) {
    const previewCount = Math.min(3, rawCodeLines.length);
    for (let idx = 0; idx < previewCount; idx++) {
      const safeStyled = (rawCodeLines[idx] || "").replace(/\x1b\[0m/g, `\x1b[0m${CODE_BG}`);
      lines.push(renderFormattedLine(safeStyled, idx));
    }
    if (rawCodeLines.length > 3) {
      lines.push(
        styleBlockLine(
          `\x1b[2m    ... (${rawCodeLines.length - 3} líneas más · clic en [ ▼ ] para expandir)\x1b[22m`,
        ),
      );
    }
  } else if (!isErrorBox && highlightCode) {
    const highlightedLines = highlightCode(text, rawLang);
    for (let idx = 0; idx < highlightedLines.length; idx++) {
      const hlLine = highlightedLines[idx]!;
      const safeHl = hlLine.replace(/\x1b\[0m/g, `\x1b[0m${CODE_BG}`);
      lines.push(renderFormattedLine(safeHl, idx));
    }
  } else {
    for (let idx = 0; idx < rawCodeLines.length; idx++) {
      const codeLine = rawCodeLines[idx]!;
      const styled = isErrorBox
        ? `\x1b[38;2;255;120;120m${codeLine}\x1b[0m`
        : codeBlockThemeFn
        ? codeBlockThemeFn(codeLine)
        : codeLine;
      const safeStyled = styled.replace(/\x1b\[0m/g, `\x1b[0m${CODE_BG}`);
      lines.push(renderFormattedLine(safeStyled, idx));
    }
  }

  lines.push(bottomRow);
  return lines;
}
