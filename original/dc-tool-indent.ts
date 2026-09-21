/**
 * dc-tool-indent — Cajas y cards redondeadas para herramientas en el body (DC Studio).
 *
 * Enmarca cada bloque de ejecución de tools (write, read, bash, edit, grep, etc.)
 * en una card elegante con borde redondeado (╭─ icon tool ─╮, │, ╰─╯), fondo sutil
 * y márgenes alineados con el chat.
 *
 * Vive en `~/.pi/agent/extensions/` para sobrevivir a todos los updates de Pi y gentle-pi.
 *
 * Comandos:
 *   /tool-box [on|off] — Activa o desactiva las cajas redondeadas.
 *   /tool-indent [0-8|off|on] — Ajusta el margen horizontal (default: 2 espacios).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import { notifyHerdr } from "./dc-notify.ts";

const ORIG_RENDER = Symbol.for("dc.tool-execution.orig-render");
const ORIG_HANDLE_MOUSE = Symbol.for("dc.tool-execution.orig-handle-mouse");
const LAST_COPY_REGION = Symbol.for("dc.tool-execution.last-copy-region");
const LAST_BODY_TEXT = Symbol.for("dc.tool-execution.last-body-text");

function copyToClipboard(text: string): void {
  try {
    const b64 = Buffer.from(text).toString("base64");
    process.stdout.write(`\x1b]52;c;${b64}\x07`);
  } catch {
    /* noop */
  }
  try {
    const p = spawn("xsel", ["-b", "-i"], { stdio: ["pipe", "ignore", "ignore"] });
    p.stdin?.write(text);
    p.stdin?.end();
  } catch {
    /* noop */
  }
}

let indent = 2;
let boxEnabled = true;

const TOOL_ICONS: Record<string, string> = {
  write: "✍",
  read: "📖",
  edit: "✏",
  bash: "📟",
  grep: "🔍",
  find: "🔎",
  ls: "📂",
  todo: "📋",
  agent: "🤖",
  subagent_run: "🤖",
  subagent_result: "🤖",
  mem_save: "🧠",
  mem_search: "🧠",
  mem_update: "🧠",
  mem_delete: "🧠",
  mem_context: "🧠",
  mem_session_summary: "🧠",
  fetch_content: "🌐",
  web_search: "🌐",
  source_check: "🔎",
};

function installPatch(): void {
  const proto = ToolExecutionComponent?.prototype as Record<symbol | string, any> | undefined;
  if (!proto) return;

  // Guardar el método nativo original una sola vez para que en /reload nunca se anide
  if (!proto[ORIG_RENDER]) {
    proto[ORIG_RENDER] = proto.render;
    proto[ORIG_HANDLE_MOUSE] = proto.handleMouse;
  }

  const ORIG_UPDATE_RESULT = Symbol.for("dc.tool-execution.orig-update-result");
  if (!proto[ORIG_UPDATE_RESULT]) {
    proto[ORIG_UPDATE_RESULT] = proto.updateResult;
  }
  const origUpdateResult = proto[ORIG_UPDATE_RESULT] as (res: unknown, isPartial?: boolean) => void;
  proto.updateResult = function (result: any, isPartial = false) {
    try {
      if (!isPartial && result?.isError) {
        const text = (result.content as Array<{ text?: string }> | undefined)
          ?.map((c) => c.text ?? "")
          .join(" ") || "";
        if (text.includes("Operation aborted") || text.includes("aborted")) {
          const tool = String(this.toolName || "Herramienta");
          notifyHerdr("Operación abortada", `${tool}: ejecución cancelada`);
        }
      }
    } catch {
      /* noop */
    }
    return origUpdateResult.call(this, result, isPartial);
  };

  const origRender = proto[ORIG_RENDER] as (width: number) => string[];
  const origHandleMouse = proto[ORIG_HANDLE_MOUSE] as (event: TuiMouseEvent) => TuiMouseEventResult | undefined;

  // Reemplazar siempre con la versión más reciente (reload-safe)
  proto.render = function (width: number): string[] {
    const margin = width > 40 ? indent : (width > 20 ? Math.min(indent, 1) : 0);
    const leftPad = " ".repeat(margin);
    const rightPad = leftPad;

    if (!boxEnabled || margin <= 0 || width < 28) {
      if (margin <= 0) return origRender.call(this, width);
      const innerWidth = Math.max(10, width - margin * 2);
      const lines: string[] = origRender.call(this, innerWidth);
      if (!lines || lines.length === 0) return lines;
      return lines.map((line) => {
        if (!line || line.includes("\x1b_G") || line.includes("\x1b]1337;")) return line;
        return leftPad + line + rightPad;
      });
    }

    const cardW = Math.max(10, width - margin * 2);
    const innerContentW = Math.max(6, cardW - 4);
    const rawLines: string[] = origRender.call(this, innerContentW);
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
    // Borde rojo vivo si hay error, bloodMid si fue éxito o en progreso
    const borderCol = isError ? "\x1b[38;2;255;0;0m" : "\x1b[38;2;255;77;77m";
    const reset = "\x1b[0m";
    const side = `${borderCol}│${reset}`;

    // Detectar si la herramienta es colapsable (tiene hint nativo o muchas líneas)
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
    const toolName = rawName.toLowerCase();
    const icon = TOOL_ICONS[toolName] || "🛠";
    const statusGlyph = isError ? " ✖" : (this.result ? " ✓" : " …");
    const badge = ` ${icon}  ${rawName}${statusGlyph} `;
    const badgeLen = visibleWidth(badge);

    // Indicador de colapso con flechas: [▼] cerrado, [▲] abierto (en blanco brillante)
    // Homogéneo para TODAS las herramientas sin excepción
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

    // Determinar si Box agregó líneas de padding arriba y abajo (cuando no es renderShell: "self")
    const hasBoxPadding =
      filteredRawLines.length >= 4 &&
      filteredRawLines[0] === "" &&
      filteredRawLines[1].replace(/\x1b\[[0-9;]*m/g, "").trim() === "" &&
      filteredRawLines[filteredRawLines.length - 1].replace(/\x1b\[[0-9;]*m/g, "").trim() === "";

    const startIdx = hasBoxPadding ? 2 : (filteredRawLines[0] === "" ? 1 : 0);
    const endIdx = hasBoxPadding ? filteredRawLines.length - 1 : filteredRawLines.length;

    const bodyLines: string[] = [];
    const plainBodyLines: string[] = [];
    const targetW = cardW - 4;

    for (let i = startIdx; i < endIdx; i++) {
      const line = filteredRawLines[i];
      if (line === undefined) continue;
      if (line.includes("\x1b_G") || line.includes("\x1b]1337;")) {
        bodyLines.push(line);
        continue;
      }
      // Limpiar backgrounds previos para recalcular el ancho exacto del contenido
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
    const margin = event.width > 40 ? indent : (event.width > 20 ? Math.min(indent, 1) : 0);

    // Clic en el botón [📋 copiar] en el borde inferior
    if (event.type === "click" && (event.button ?? "left") === "left") {
      const copyRegion = (this as any)[LAST_COPY_REGION];
      if (copyRegion && event.y === copyRegion.y && event.x >= copyRegion.startX) {
        let textToCopy = "";
        const result = (this as any).result;
        if (result?.content && Array.isArray(result.content)) {
          textToCopy = result.content
            .map((c: any) => c.text ?? (typeof c === "string" ? c : ""))
            .filter(Boolean)
            .join("\n");
        }
        if (!textToCopy && result?.error) {
          textToCopy = typeof result.error === "string" ? result.error : result.error?.message || String(result.error);
        }
        if (!textToCopy && result?.message) {
          textToCopy = String(result.message);
        }
        if (!textToCopy && (this as any)[LAST_BODY_TEXT]) {
          textToCopy = (this as any)[LAST_BODY_TEXT];
        }
        const params = (this as any).params;
        if (!textToCopy && params) {
          textToCopy = typeof params === "string" ? params : JSON.stringify(params, null, 2);
        }
        if (textToCopy) {
          copyToClipboard(textToCopy);
          const tool = String((this as any).toolName || "herramienta");
          const isErr = Boolean((this as any).result?.isError);
          notifyHerdr("📋 Portapapeles", isErr ? `Copiado error de ${tool}` : `Copiado contenido de ${tool}`);
          return { handled: true };
        }
      }
    }

    if (!boxEnabled || margin <= 0) {
      if (margin <= 0) return origHandleMouse.call(this, event);
      const contentX = event.x - margin;
      const innerWidth = Math.max(10, event.width - margin * 2);
      if (contentX < 0 || contentX >= innerWidth) return undefined;
      return origHandleMouse.call(this, { ...event, x: contentX, width: innerWidth });
    }

    const cardW = Math.max(10, event.width - margin * 2);
    const contentW = Math.max(6, cardW - 4);
    const contentX = event.x - margin - 2;
    if (contentX < 0 || contentX >= contentW) return undefined;

    return origHandleMouse.call(this, {
      ...event,
      x: contentX,
      width: contentW,
    });
  };
}

export default function toolIndentExtension(pi: ExtensionAPI): void {
  installPatch();

  pi.on("session_start", () => {
    installPatch();
  });

  pi.registerCommand("tool-box", {
    description: "Alternar cajas redondeadas para tools (/tool-box [on|off])",
    handler: async (args: string, ctx: ExtensionContext) => {
      const trimmed = (args ?? "").trim().toLowerCase();
      if (!trimmed) {
        ctx.ui.notify(`tool-box: ${boxEnabled ? "activado" : "desactivado"}`, "info");
        return;
      }
      if (trimmed === "off" || trimmed === "0") {
        boxEnabled = false;
        (ctx.ui as any).requestRender?.();
        ctx.ui.notify("tool-box: desactivado", "info");
        return;
      }
      if (trimmed === "on" || trimmed === "1") {
        boxEnabled = true;
        (ctx.ui as any).requestRender?.();
        ctx.ui.notify("tool-box: activado", "info");
        return;
      }
      ctx.ui.notify("Uso: /tool-box [on | off]", "warning");
    },
  });

  pi.registerCommand("tool-indent", {
    description: "Configurar sangría de bloques de tools (/tool-indent [0-8|off|on])",
    handler: async (args: string, ctx: ExtensionContext) => {
      const trimmed = (args ?? "").trim().toLowerCase();
      if (!trimmed) {
        ctx.ui.notify(`tool-indent: actual = ${indent} espacios`, "info");
        return;
      }
      if (trimmed === "off" || trimmed === "0") {
        indent = 0;
        (ctx.ui as any).requestRender?.();
        ctx.ui.notify("tool-indent: desactivado (0 espacios)", "info");
        return;
      }
      if (trimmed === "on") {
        indent = 2;
        (ctx.ui as any).requestRender?.();
        ctx.ui.notify("tool-indent: activado (2 espacios)", "info");
        return;
      }
      const n = parseInt(trimmed, 10);
      if (isNaN(n) || n < 0 || n > 8) {
        ctx.ui.notify("Uso: /tool-indent [0-8 | off | on]", "warning");
        return;
      }
      indent = n;
      (ctx.ui as any).requestRender?.();
      ctx.ui.notify(`tool-indent: configurado a ${indent} espacios`, "info");
    },
  });
}
