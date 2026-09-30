import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { dcClipboard } from "../../integrations/dc-clipboard/dc-clipboard.ts";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { getToolIcon } from "./dc-tool-box-icons.ts";

export const ORIG_RENDER = Symbol.for("dc.tool-execution.orig-render");
export const ORIG_HANDLE_MOUSE = Symbol.for("dc.tool-execution.orig-handle-mouse");
export const ORIG_UPDATE_RESULT = Symbol.for("dc.tool-execution.orig-update-result");
export const LAST_COPY_REGION = Symbol.for("dc.tool-execution.last-copy-region");
export const LAST_BODY_TEXT = Symbol.for("dc.tool-execution.last-body-text");

export interface DcToolBoxConfig {
  indent: number;
  boxEnabled: boolean;
}

const config: DcToolBoxConfig = {
  indent: 2,
  boxEnabled: true,
};

export function isToolBoxEnabled(): boolean {
  return config.boxEnabled;
}

export function setToolBoxEnabled(enabled: boolean): void {
  config.boxEnabled = enabled;
}

export function getToolBoxIndent(): number {
  return config.indent;
}

export function setToolBoxIndent(indent: number): void {
  config.indent = Math.max(0, Math.min(8, indent));
}

/**
 * Instala el formateador de cajas redondeadas en ToolExecutionComponent.prototype.
 * Es idempotente y seguro ante recargas (/reload).
 */
export function installToolBoxPatch(): boolean {
  const proto = (ToolExecutionComponent as any)?.prototype as Record<symbol | string, any> | undefined;
  if (!proto) return false;

  // Preservar métodos nativos originales
  if (!proto[ORIG_RENDER]) {
    proto[ORIG_RENDER] = proto.render;
    proto[ORIG_HANDLE_MOUSE] = proto.handleMouse;
  }

  if (!proto[ORIG_UPDATE_RESULT] && typeof proto.updateResult === "function") {
    proto[ORIG_UPDATE_RESULT] = proto.updateResult;
    const origUpdate = proto[ORIG_UPDATE_RESULT];
    proto.updateResult = function (result: any, isPartial = false) {
      try {
        if (!isPartial && result?.isError) {
          const text = (result.content as Array<{ text?: string }> | undefined)
            ?.map((c) => c.text ?? "")
            .join(" ") || "";
          if (text.includes("Operation aborted") || text.includes("aborted")) {
            // No emitir notifyHerdr aquí para evitar saturar el socket
          }
        }
      } catch {
        /* noop */
      }
      return origUpdate.call(this, result, isPartial);
    };
  }

  proto.render = function (width: number): string[] {
    const orig = (this as any)[ORIG_RENDER] ?? proto[ORIG_RENDER];
    const margin = width > 40 ? config.indent : (width > 20 ? Math.min(config.indent, 1) : 0);
    const leftPad = " ".repeat(margin);
    const rightPad = leftPad;

    if (!config.boxEnabled || margin <= 0 || width < 28) {
      if (margin <= 0) return orig.call(this, width);
      const innerWidth = Math.max(10, width - margin * 2);
      const lines: string[] = orig.call(this, innerWidth);
      if (!lines || lines.length === 0) return lines;
      return lines.map((line: string) => {
        if (!line || line.includes("\x1b_G") || line.includes("\x1b]1337;")) return line;
        return leftPad + line + rightPad;
      });
    }

    const cardW = Math.max(10, width - margin * 2);
    const innerContentW = Math.max(6, cardW - 4);
    const rawLines: string[] = orig.call(this, innerContentW);
    if (!rawLines || rawLines.length === 0) return rawLines;

    // Detectar fondo ANSI de la herramienta
    let bgAnsi = "";
    for (const l of rawLines) {
      const m = l.match(/\x1b\[48;2;[0-9;]+m/);
      if (m) {
        bgAnsi = m[0];
        break;
      }
    }
    const isError = Boolean(this.result?.isError);
    if (!bgAnsi) bgAnsi = isError ? "\x1b[48;2;51;0;0m" : "\x1b[48;2;31;13;13m";
    const borderCol = isError ? "\x1b[38;2;255;0;0m" : "\x1b[38;2;255;77;77m";
    const reset = "\x1b[0m";
    const side = `${borderCol}│${reset}`;

    // Filtrar hint nativo de Pi si está presente
    let isCollapsible = false;
    const filteredRawLines: string[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i]!;
      const plain = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (/ctrl\+o to (?:expand|collapse)/i.test(plain)) {
        isCollapsible = true;
      } else {
        filteredRawLines.push(line);
      }
    }
    if (!isCollapsible && rawLines.length > 3) {
      isCollapsible = true;
    }

    const rawName = String(this.toolName || "tool");
    const icon = getToolIcon(rawName);
    const statusGlyph = isError ? " ✖" : (this.result ? " ✓" : " …");
    const badge = ` ${icon}  ${rawName}${statusGlyph} `;
    const badgeLen = visibleWidth(badge);

    // Indicador de colapso [▼] cerrado, [▲] abierto
    const arrowSymbol = this.expanded ? "▲" : "▼";
    const arrowBadge = ` ${arrowSymbol} `;
    const arrowLen = visibleWidth(arrowBadge);
    const topBorderRightDashes = 3;
    const availableDashes = Math.max(0, cardW - 3 - badgeLen - arrowLen - topBorderRightDashes);

    let topBorder = "";
    if (arrowBadge && availableDashes >= 1) {
      const whiteArrow = `\x1b[38;2;255;255;255m${arrowBadge}\x1b[0m`;
      topBorder = `${borderCol}╭─${badge}${"─".repeat(availableDashes)}${whiteArrow}${borderCol}${"─".repeat(topBorderRightDashes)}╮${reset}`;
    } else {
      topBorder = `${borderCol}╭─${badge}${"─".repeat(Math.max(0, cardW - 3 - badgeLen))}╮${reset}`;
    }

    const copyBadge = " 📋 ";
    const copyBadgeLen = visibleWidth(copyBadge);
    const bottomBorderRightDashes = 3;
    const bottomDashes = Math.max(0, cardW - 2 - copyBadgeLen - bottomBorderRightDashes);
    const whiteCopy = `\x1b[38;2;255;255;255m${copyBadge}\x1b[0m`;
    const bottomBorder = `${borderCol}╰${"─".repeat(bottomDashes)}${whiteCopy}${borderCol}${"─".repeat(bottomBorderRightDashes)}╯${reset}`;

    const topRow = `${leftPad}${bgAnsi}${topBorder.replace(/\x1b\[0m/g, `\x1b[0m${bgAnsi}`)}\x1b[49m${rightPad}`;
    const bottomRow = `${leftPad}${bgAnsi}${bottomBorder.replace(/\x1b\[0m/g, `\x1b[0m${bgAnsi}`)}\x1b[49m${rightPad}`;

    // Normalizar líneas y desanidar cajas de quiet-tools / extensiones previas si las hay
    let linesToProcess = filteredRawLines.map((l) => l ?? "");
    let trimStart = 0;
    while (trimStart < linesToProcess.length && linesToProcess[trimStart]!.replace(/\x1b\[[0-9;]*m/g, "").trim() === "") {
      trimStart++;
    }
    let trimEnd = linesToProcess.length;
    while (trimEnd > trimStart && linesToProcess[trimEnd - 1]!.replace(/\x1b\[[0-9;]*m/g, "").trim() === "") {
      trimEnd--;
    }
    linesToProcess = linesToProcess.slice(trimStart, trimEnd);

    const firstPlain = linesToProcess[0]?.replace(/\x1b\[[0-9;]*m/g, "").trim() ?? "";
    const lastPlain = linesToProcess[linesToProcess.length - 1]?.replace(/\x1b\[[0-9;]*m/g, "").trim() ?? "";
    const isEnclosedCard =
      (firstPlain.startsWith("╭") || firstPlain.startsWith("┌")) &&
      (lastPlain.endsWith("╯") || lastPlain.endsWith("┘"));

    if (isEnclosedCard) {
      const unwrapped: string[] = [];
      for (let i = 0; i < linesToProcess.length; i++) {
        const l = linesToProcess[i]!;
        const p = l.replace(/\x1b\[[0-9;]*m/g, "").trim();
        if (i === 0 && (p.startsWith("╭") || p.startsWith("┌"))) {
          const match = p.match(/^[╭┌]─*\s*(?:[✿❀⛩]|[^─]+?)?\s*(.*?)\s*─*[╮┐]$/);
          const titleContent = match ? match[1]?.trim() : "";
          if (titleContent) {
            unwrapped.push(titleContent);
          }
          continue;
        }
        if (i === linesToProcess.length - 1 && (p.endsWith("╯") || p.endsWith("┘"))) {
          // Omitir el borde inferior anidado para evitar la doble línea
          continue;
        }
        let cleaned = l.replace(/\x1b\[[0-9;]*m/g, "");
        cleaned = cleaned.replace(/^\s*[│|]\s?/, "").replace(/\s?[│|]\s*$/, "");
        if (cleaned.trim() !== "" || i < linesToProcess.length - 2) {
          unwrapped.push(cleaned);
        }
      }
      while (unwrapped.length > 0 && unwrapped[unwrapped.length - 1]!.trim() === "") {
        unwrapped.pop();
      }
      linesToProcess = unwrapped;
    }

    const bodyLines: string[] = [];
    const plainBodyLines: string[] = [];
    const targetW = cardW - 4;

    for (let i = 0; i < linesToProcess.length; i++) {
      const line = linesToProcess[i];
      if (line === undefined) continue;
      if (line.includes("\x1b_G") || line.includes("\x1b]1337;")) {
        bodyLines.push(line);
        continue;
      }
      const clean = line.replace(/\x1b\[48;2;[0-9;]+m/g, "").replace(/\x1b\[49m/g, "").trimEnd();
      plainBodyLines.push(clean.replace(/\x1b\[[0-9;]*m/g, ""));
      const v = visibleWidth(clean);
      const cell = v > targetW ? truncateToWidth(clean, targetW, "") : clean + " ".repeat(Math.max(0, targetW - v));
      const row = `${side} ${cell} ${side}`;
      const pres = row.replace(/\x1b\[0m/g, `\x1b[0m${bgAnsi}`).replace(/\x1b\[49m/g, bgAnsi);
      bodyLines.push(`${leftPad}${bgAnsi}${pres}\x1b[49m${rightPad}`);
    }

    (this as any)[LAST_BODY_TEXT] = plainBodyLines.join("\n");
    (this as any)[LAST_COPY_REGION] = {
      y: 2 + bodyLines.length,
      startX: margin + cardW - 1 - bottomBorderRightDashes - copyBadgeLen,
      endX: margin + cardW,
    };

    return ["", topRow, ...bodyLines, bottomRow];
  };

  proto.handleMouse = function (event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const margin = event.width > 40 ? config.indent : (event.width > 20 ? Math.min(config.indent, 1) : 0);

    // Clic en botón 📋 copiar en borde inferior
    if (event.type === "click" && (event.button ?? "left") === "left") {
      const copyRegion = (this as any)[LAST_COPY_REGION];
      if (copyRegion && event.y === copyRegion.y && event.x >= copyRegion.startX) {
        let textToCopy = "";
        const result = (this as any).result;

        if (result) {
          if (typeof result === "string") {
            textToCopy = result;
          } else if (Array.isArray(result.content)) {
            textToCopy = result.content.map((c: any) => c.text ?? "").join("\n");
          } else if (result.text) {
            textToCopy = String(result.text);
          }
        }

        if (!textToCopy) {
          textToCopy = (this as any)[LAST_BODY_TEXT] || "";
        }

        if (textToCopy.trim()) {
          void dcClipboard.copy(textToCopy);
        }
        return { handled: true };
      }
    }

    // Traducir coordenadas de mouse para el contenido interior
    const translated: TuiMouseEvent = {
      ...event,
      x: event.x - margin - 2,
      y: event.y - 1,
      width: Math.max(4, event.width - margin * 2 - 4),
    };

    const origMouse = (this as any)[ORIG_HANDLE_MOUSE] ?? proto[ORIG_HANDLE_MOUSE];
    if (typeof origMouse === "function") {
      return origMouse.call(this, translated);
    }
    return undefined;
  };

  return true;
}
