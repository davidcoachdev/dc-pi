/**
 * dc-user-prompt — Enmarca los mensajes (prompts) del usuario en cards estilo DC Studio.
 *
 * Transforma el bloque plano del mensaje del usuario en una card con:
 * - Borde redondeado (╭─ nombre ─╮, │, ╰─╯) idéntico a los bloques de código (dc-markdown).
 * - Mismo color de fondo nativo del mensaje (userMessageBg).
 * - Título en el borde superior con el nombre del usuario (de dc-user.ts / userName()).
 * - Márgenes alineados con el chat (mismo sangrado que dc-tool-indent y dc-markdown).
 * - Compatible con reload y preserva las zonas de control OSC133.
 *
 * Comandos:
 *   /user-box [on|off|pad] — Activa, desactiva o alterna padding vertical en las cards.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { notifyHerdr } from "./dc-notify.ts";
import { userName } from "./dc-user.ts";

const ORIG_RENDER = Symbol.for("dc.user-message.orig-render");
const ORIG_HANDLE_MOUSE = Symbol.for("dc.user-message.orig-handle-mouse");
const LAST_COPY_REGION = Symbol.for("dc.user-message.last-copy-region");
const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

let boxEnabled = true;
let verticalPadding = false;

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

function resolveUserName(): string {
  try {
    const name = userName?.()?.trim();
    if (name) return name;
  } catch {
    /* fallback a lectura directa */
  }

  try {
    const file = path.join(os.homedir(), ".pi/agent/dc-user.json");
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { name?: string };
      if (parsed?.name?.trim()) return parsed.name.trim();
    }
  } catch {
    /* noop */
  }

  return "User";
}

function installPatch(): void {
  const proto = UserMessageComponent?.prototype as Record<symbol | string, any> | undefined;
  if (!proto) return;

  if (!proto[ORIG_RENDER]) {
    proto[ORIG_RENDER] = proto.render;
  }

  const origRender = proto[ORIG_RENDER] as (width: number) => string[];

  proto.render = function (width: number): string[] {
    if (!boxEnabled || width < 28) {
      return origRender.call(this, width);
    }

    const marginW = width > 40 ? 2 : (width > 20 ? 1 : 0);
    const cardW = Math.max(8, width - marginW * 2);
    const innerW = Math.max(4, cardW - 4);
    const leftMargin = " ".repeat(marginW);
    const rightMargin = leftMargin;

    // Detectar color de borde (mismo que bloques de código Markdown)
    const border = (s: string) => {
      if (this.markdownTheme?.codeBlockBorder) {
        return this.markdownTheme.codeBlockBorder(s);
      }
      return s;
    };
    const sideBorder = border("│");

    // Detectar fondo ANSI de userMessageBg
    let bgAnsi = "";
    try {
      const testSample = origRender.call(this, 10);
      for (const line of testSample) {
        const m = line.match(/\x1b\[48;2;[0-9;]+m/) || line.match(/\x1b\[48;5;[0-9]+m/) || line.match(/\x1b\[4[0-7]m/);
        if (m) {
          bgAnsi = m[0];
          break;
        }
      }
    } catch {
      /* fallback */
    }
    if (!bgAnsi) bgAnsi = "\x1b[48;2;26;26;26m";

    // Título superior con el nombre del usuario y glifo DC
    const name = resolveUserName();
    const icon = "⛩";
    const titlePart = `${icon}  ${name} `;
    const fillLen = Math.max(0, cardW - 3 - visibleWidth(titlePart) - 1);
    const styledTitle = this.markdownTheme?.bold ? this.markdownTheme.bold(titlePart) : titlePart;
    const topBorder = border("╭─ ") + border(styledTitle) + border("─".repeat(fillLen)) + border("╮");

    const copyBadge = " 📋 ";
    const copyBadgeLen = visibleWidth(copyBadge);
    const rightDashes = 3;
    const bottomDashes = Math.max(0, cardW - 2 - copyBadgeLen - rightDashes);
    const whiteCopy = `\x1b[38;2;255;255;255m${copyBadge}\x1b[0m`;
    const bottomBorder = border(`╰${"─".repeat(bottomDashes)}`) + whiteCopy + border(`${"─".repeat(rightDashes)}╯`);

    const topRow = (): string => {
      const pres = topBorder.replace(/\x1b\[0m/g, `\x1b[0m${bgAnsi}`).replace(/\x1b\[49m/g, bgAnsi);
      return `${leftMargin}${bgAnsi}${pres}\x1b[49m${rightMargin}`;
    };

    const bottomRow = (): string => {
      const pres = bottomBorder.replace(/\x1b\[0m/g, `\x1b[0m${bgAnsi}`).replace(/\x1b\[49m/g, bgAnsi);
      return `${leftMargin}${bgAnsi}${pres}\x1b[49m${rightMargin}`;
    };

    const styleLine = (content: string): string => {
      const v = visibleWidth(content);
      const textCell = v > innerW ? truncateToWidth(content, innerW, "") : content + " ".repeat(Math.max(0, innerW - v));
      const row = `${sideBorder} ${textCell} ${sideBorder}`;
      const pres = row.replace(/\x1b\[0m/g, `\x1b[0m${bgAnsi}`).replace(/\x1b\[49m/g, bgAnsi);
      return `${leftMargin}${bgAnsi}${pres}\x1b[49m${rightMargin}`;
    };

    // Renderizar líneas del mensaje
    let bodyLines: string[] = [];
    const mdComponent = this.children?.[0]?.children?.[0];

    if (mdComponent && typeof mdComponent.render === "function") {
      bodyLines = mdComponent.render(innerW);
    } else {
      // Fallback si la estructura interna de Box/Markdown cambia
      const raw = origRender.call(this, innerW);
      // Quitar padding vacío nativo superior/inferior si existe
      let start = 0;
      let end = raw.length;
      if (raw.length >= 3 && raw[0]?.replace(/\x1b\[[0-9;]*m/g, "").trim() === "") {
        start = 1;
      }
      if (raw.length >= 3 && raw[raw.length - 1]?.replace(/\x1b\[[0-9;]*m/g, "").trim() === "") {
        end = raw.length - 1;
      }
      bodyLines = raw.slice(start, end).map((l) => l.replace(/\x1b\[48;2;[0-9;]+m/g, "").replace(/\x1b\[49m/g, "").trimEnd());
    }

    if (bodyLines.length === 0) {
      bodyLines = [""];
    }

    const out: string[] = [];
    out.push(topRow());

    if (verticalPadding) {
      out.push(styleLine(""));
    }

    for (const line of bodyLines) {
      out.push(styleLine(line));
    }

    if (verticalPadding) {
      out.push(styleLine(""));
    }

    out.push(bottomRow());

    (this as any)[LAST_COPY_REGION] = {
      y: out.length - 1,
      startX: marginW + cardW - 1 - rightDashes - copyBadgeLen,
      endX: marginW + cardW,
    };

    // Preservar marcadores OSC133
    if (out.length > 0) {
      out[0] = OSC133_ZONE_START + out[0];
      out[out.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + out[out.length - 1];
    }

    return out;
  };

  if (!proto[ORIG_HANDLE_MOUSE]) {
    proto[ORIG_HANDLE_MOUSE] = proto.handleMouse;
  }
  const origHandleMouse = proto[ORIG_HANDLE_MOUSE];

  proto.handleMouse = function (event: TuiMouseEvent): TuiMouseEventResult | undefined {
    // Clic en el botón [📋] en el borde inferior
    if (event.type === "click" && (event.button ?? "left") === "left") {
      const copyRegion = (this as any)[LAST_COPY_REGION];
      if (copyRegion && event.y === copyRegion.y && event.x >= copyRegion.startX) {
        const textToCopy = (this as any).text || "";
        if (textToCopy) {
          copyToClipboard(textToCopy);
          notifyHerdr("📋 Portapapeles", "Copiado prompt del usuario");
          return { handled: true };
        }
      }
    }
    return origHandleMouse?.call(this, event);
  };
}

export default function dcUserPromptExtension(pi: ExtensionAPI): void {
  installPatch();

  pi.on("session_start", () => {
    installPatch();
  });

  pi.registerCommand("user-box", {
    description: "Caja redondeada para mensajes del usuario (/user-box [on|off|pad])",
    handler: async (args: string, ctx: ExtensionContext) => {
      const trimmed = (args ?? "").trim().toLowerCase();
      if (!trimmed) {
        ctx.ui.notify(`user-box: ${boxEnabled ? "activado" : "desactivado"} (pad: ${verticalPadding ? "on" : "off"})`, "info");
        return;
      }
      if (trimmed === "off" || trimmed === "0") {
        boxEnabled = false;
        (ctx.ui as any).requestRender?.();
        ctx.ui.notify("user-box: desactivado", "info");
        return;
      }
      if (trimmed === "on" || trimmed === "1") {
        boxEnabled = true;
        (ctx.ui as any).requestRender?.();
        ctx.ui.notify("user-box: activado", "info");
        return;
      }
      if (trimmed === "pad" || trimmed === "padding") {
        verticalPadding = !verticalPadding;
        (ctx.ui as any).requestRender?.();
        ctx.ui.notify(`user-box: padding vertical ${verticalPadding ? "activado" : "desactivado"}`, "info");
        return;
      }
      ctx.ui.notify("Uso: /user-box [on | off | pad]", "warning");
    },
  });
}
