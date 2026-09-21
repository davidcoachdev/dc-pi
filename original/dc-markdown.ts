/**
 * dc-markdown — Renderer de Markdown custom para DC Studio.
 *
 * Resuelve tres limitaciones del renderer nativo de pi-tui:
 * 1. Headings (H3+): elimina los molestos "### " y "#### " crudos de la terminal,
 *    reemplazándolos por glifos elegantes ("◆ ", "▸ ") estilizados con el color del tema.
 * 2. Bloques de código (```): enmarca el código en una caja redondeada con marco
 *    (╭─ lang ─╮, │, ╰─╯), fondo sutil y sangría integrada, en vez de imprimir
 *    los tres backticks crudos (```ts).
 * 3. Bloques de error (```error): enmarca errores y fallos de API en cajas de error
 *    con borde rojo sangre, glifo de calavera (╭─ ☠️  Error ─╮, │, ╰─╯) y fondo sutil.
 * 4. Captura y renderizado de errores del sistema/LLM: intercepta AssistantMessageComponent
 *    e InteractiveMode.prototype.showError para formatear errores y reintentos (incluyendo
 *    JSONs crudos 503/429) dentro de cajas Markdown de error.
 *
 * Vive en `~/.pi/agent/extensions/` para sobrevivir a todos los updates de Pi.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent, ExtensionRunner, InteractiveMode } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { Markdown, Spacer, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import { notifyHerdr } from "./dc-notify.ts";

const ORIG_RENDER_TOKEN = Symbol.for("dc.markdown.orig-render-token");
const ORIG_ASSISTANT_UPDATE = Symbol.for("dc.assistant-message.orig-update-content");
const ORIG_ASSISTANT_RENDER = Symbol.for("dc.assistant-message.orig-render");
const ORIG_ASSISTANT_MOUSE = Symbol.for("dc.assistant-message.orig-handle-mouse");
const LAST_ASSISTANT_COPY = Symbol.for("dc.assistant-message.last-copy-region");
const ORIG_SHOW_ERROR = Symbol.for("dc.interactive-mode.orig-show-error");
const ORIG_RUNNER_GET_MSG_RENDERER = Symbol.for("dc.extension-runner.orig-get-message-renderer");
const ORIG_RUNNER_GET_ENTRY_RENDERER = Symbol.for("dc.extension-runner.orig-get-entry-renderer");

let codeBoxEnabled = true;
let activeUiTheme: any = null;

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

// Factor de opacidad: 0.50 = mezcla 50% color del tema y 50% fondo de terminal
const CARD_OPACITY = 0.50;

// ── Calibración exacta con la paleta de Dc-Studio ─────────────────────────
// panel: #0d0d0d, toolSuccessBg: #1f0d0d, toolErrorBg: #330000
// bloodBright: #ff3333, bloodMid: #ff4d4d, bloodSoft: #ff8080, bloodWhite: #ffcccc
const DC_PANEL_R = 13;
const DC_PANEL_G = 13;
const DC_PANEL_B = 13;

const DEFAULT_BG = "\x1b[48;2;31;13;13m";     // #1f0d0d (toolSuccessBg)
const DEFAULT_BORDER = "\x1b[38;2;255;77;77m"; // #ff4d4d (bloodMid)
const DEFAULT_TAG = "\x1b[38;2;255;51;51m";    // #ff3333 (bloodBright)

const LANG_ICONS: Record<string, string> = {
  go: "",
  golang: "",
  ts: "",
  typescript: "",
  js: "",
  javascript: "",
  py: "",
  python: "",
  rs: "",
  rust: "",
  sh: "📟",
  bash: "📟",
  zsh: "📟",
  shell: "📟",
  json: "",
  yaml: "",
  yml: "",
  toml: "",
  html: "🌐",
  css: "🎨",
  sql: "🗄",
  md: "📝",
  markdown: "📝",
  dockerfile: "",
  docker: "",
  diff: "±",
};

function blendWithBackground(colorAnsi: string, opacity: number = CARD_OPACITY): string {
  const match = colorAnsi.match(/48;2;(\d+);(\d+);(\d+)m/);
  if (!match) return colorAnsi;

  const r = parseInt(match[1]!, 10);
  const g = parseInt(match[2]!, 10);
  const b = parseInt(match[3]!, 10);

  // Fondo base de la terminal DC Studio (#0d0d0d)
  const baseR = DC_PANEL_R;
  const baseG = DC_PANEL_G;
  const baseB = DC_PANEL_B;

  const blendedR = Math.round(r * opacity + baseR * (1 - opacity));
  const blendedG = Math.round(g * opacity + baseG * (1 - opacity));
  const blendedB = Math.round(b * opacity + baseB * (1 - opacity));

  return `\x1b[48;2;${blendedR};${blendedG};${blendedB}m`;
}

function strWidth(s: string): number {
  return visibleWidth(s);
}

function resolveColors(isErrorBox: boolean) {
  if (isErrorBox) {
    return {
      bgAnsi: blendWithBackground("\x1b[48;2;51;0;0m", 0.75), // #330000 toolErrorBg
      borderAnsi: "\x1b[38;2;255;0;0m",                      // #ff0000 blood
      tagAnsi: "\x1b[38;2;255;51;51m",                       // #ff3333 bloodBright
    };
  }

  let bgAnsi = DEFAULT_BG;
  let borderAnsi = DEFAULT_BORDER;
  let tagAnsi = DEFAULT_TAG;

  if (activeUiTheme) {
    try {
      bgAnsi = activeUiTheme.getBgAnsi("toolSuccessBg");
    } catch {
      try {
        bgAnsi = activeUiTheme.getBgAnsi("userMessageBg");
      } catch {
        bgAnsi = DEFAULT_BG;
      }
    }

    try {
      borderAnsi = activeUiTheme.getFgAnsi("mdCodeBlockBorder") || activeUiTheme.getFgAnsi("borderAccent");
    } catch {
      try {
        borderAnsi = activeUiTheme.getFgAnsi("border");
      } catch {
        borderAnsi = DEFAULT_BORDER;
      }
    }

    try {
      tagAnsi = activeUiTheme.getFgAnsi("accent") || activeUiTheme.getFgAnsi("mdHeading");
    } catch {
      tagAnsi = DEFAULT_TAG;
    }
  }

  bgAnsi = blendWithBackground(bgAnsi, CARD_OPACITY);
  return { bgAnsi, borderAnsi, tagAnsi };
}

/**
 * Parsea un mensaje de error para detectar JSONs incrustados (e.g. 503/429 de APIs)
 * y los formatea con indentación limpia.
 */
function prettifyErrorContent(raw: string): string {
  const trimmed = raw.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const prefix = trimmed.slice(0, firstBrace).trim();
    const jsonStr = trimmed.slice(firstBrace, lastBrace + 1);
    const suffix = trimmed.slice(lastBrace + 1).trim();
    try {
      const parsed = JSON.parse(jsonStr);
      const pretty = JSON.stringify(parsed, null, 2);
      const parts: string[] = [];
      if (prefix) {
        // Si el prefijo termina en ":", limpiarlo para que quede prolijo
        const cleanPrefix = prefix.endsWith(":") ? prefix.slice(0, -1).trim() : prefix;
        if (cleanPrefix) parts.push(cleanPrefix);
      }
      parts.push(pretty);
      if (suffix) parts.push(suffix);
      return parts.join("\n\n");
    } catch {
      // Si falla el parseo de JSON (e.g. caracteres escapados raros), dejamos el texto
    }
  }

  return raw;
}

function installPatch(): void {
  const proto = Markdown?.prototype as Record<symbol | string, any> | undefined;
  if (!proto) return;

  // Guardar método nativo original una sola vez para que en /reload nunca se anide
  if (!proto[ORIG_RENDER_TOKEN]) {
    proto[ORIG_RENDER_TOKEN] = proto.renderToken;
  }

  const origRenderToken = proto[ORIG_RENDER_TOKEN];

  // Reemplazar siempre con la versión más reciente (reload-safe)
  proto.renderToken = function (token: any, width: number, nextTokenType: string | undefined, styleContext: any): string[] {
    if (token.type === "heading") {
      const headingLevel = token.depth;
      let headingStyleFn: (text: string) => string;
      if (headingLevel === 1) {
        headingStyleFn = (text: string) => this.theme.heading(this.theme.bold(this.theme.underline(text)));
      } else {
        headingStyleFn = (text: string) => this.theme.heading(this.theme.bold(text));
      }

      const headingStyleContext = {
        applyText: headingStyleFn,
        stylePrefix: this.getStylePrefix(headingStyleFn),
      };

      const headingText = this.renderInlineTokens(token.tokens || [], headingStyleContext);

      // En Pi nativo, H3+ imprime "### ". Acá lo reemplazamos por glifos limpios:
      const prefix = headingLevel === 3 ? "◆ " : headingLevel === 4 ? "▸ " : headingLevel > 4 ? "▪ " : "";
      const styledHeading = headingStyleFn(prefix) + headingText;

      const lines = [styledHeading];
      if (nextTokenType && nextTokenType !== "space") {
        lines.push("");
      }
      return lines;
    }

    if (token.type === "code" && codeBoxEnabled) {
      const marginW = width > 40 ? 1 : 0;
      const blockW = Math.max(8, width - marginW * 2);

      // Si el ancho es muy chico, dejamos el fallback nativo
      if (blockW < 20) {
        return origRenderToken.call(this, token, width, nextTokenType, styleContext);
      }

      const leftMargin = " ".repeat(marginW);
      const rightMargin = leftMargin;
      const innerCodeW = Math.max(4, blockW - 4);
      const indent = this.theme.codeBlockIndent ?? "  ";

      const rawLang = (token.lang || "").trim().toLowerCase();
      const isErrorBox = rawLang === "error" || rawLang === "err";
      const { bgAnsi: CODE_BG, borderAnsi: borderCol, tagAnsi } = resolveColors(isErrorBox);

      const border = (s: string) => `${borderCol}${s}\x1b[0m`;
      const sideBorder = border("│");

      const styleBlockLine = (content: string): string => {
        const v = strWidth(content);
        const textCell = v > innerCodeW ? truncateToWidth(content, innerCodeW, "") : content + " ".repeat(Math.max(0, innerCodeW - v));
        const row = `${sideBorder} ${textCell} ${sideBorder}`;
        const pres = row.replace(/\x1b\[0m/g, `\x1b[0m${CODE_BG}`).replace(/\x1b\[49m/g, CODE_BG);
        return `${leftMargin}${CODE_BG}${pres}\x1b[49m${rightMargin}`;
      };

      // Header del bloque con badge destacado e icono Nerd Font
      let titlePart = "";
      if (isErrorBox) {
        titlePart = ` ☠️  Error `;
      } else if (rawLang && rawLang !== "text" && rawLang !== "txt") {
        const icon = LANG_ICONS[rawLang] || "";
        titlePart = ` ${icon} ${rawLang} `;
      }

      const titleLen = titlePart ? strWidth(titlePart) : 0;
      const fillLen = Math.max(0, blockW - 3 - titleLen);
      const styledBadge = isErrorBox
        ? `\x1b[1m\x1b[38;2;255;80;80m${titlePart}\x1b[0m`
        : `\x1b[1m${tagAnsi}${titlePart}\x1b[0m`;

      const topBorder = titlePart
        ? `${borderCol}╭─${styledBadge}${borderCol}${"─".repeat(fillLen)}╮\x1b[0m`
        : `${borderCol}╭${"─".repeat(Math.max(0, blockW - 2))}╮\x1b[0m`;

      const topRow = (): string => {
        const pres = topBorder.replace(/\x1b\[0m/g, `\x1b[0m${CODE_BG}`).replace(/\x1b\[49m/g, CODE_BG);
        return `${leftMargin}${CODE_BG}${pres}\x1b[49m${rightMargin}`;
      };

      // Borde inferior estilizado (con botón [📋] para cajas de error)
      let bottomBorder = "";
      if (isErrorBox) {
        const copyBadge = " 📋 ";
        const copyBadgeLen = strWidth(copyBadge);
        const rightDashes = 3;
        const bottomDashes = Math.max(0, blockW - 2 - copyBadgeLen - rightDashes);
        const whiteCopy = `\x1b[38;2;255;255;255m${copyBadge}\x1b[0m`;
        bottomBorder = `${borderCol}╰${"─".repeat(bottomDashes)}${whiteCopy}${borderCol}${"─".repeat(rightDashes)}╯\x1b[0m`;
      } else {
        const bottomDashes = Math.max(0, blockW - 2);
        bottomBorder = `${borderCol}╰${"─".repeat(bottomDashes)}╯\x1b[0m`;
      }
      const bottomRow = (): string => {
        const pres = bottomBorder.replace(/\x1b\[0m/g, `\x1b[0m${CODE_BG}`).replace(/\x1b\[49m/g, CODE_BG);
        return `${leftMargin}${CODE_BG}${pres}\x1b[49m${rightMargin}`;
      };

      const lines: string[] = [];
      lines.push(topRow());

      if (!isErrorBox && this.theme.highlightCode) {
        const highlightedLines = this.theme.highlightCode(token.text, token.lang);
        for (const hlLine of highlightedLines) {
          // Restaurar fondo tras cualquier reset ANSI del resaltador de sintaxis
          const safeHl = hlLine.replace(/\x1b\[0m/g, `\x1b[0m${CODE_BG}`);
          lines.push(styleBlockLine(`${indent}${safeHl}`));
        }
      } else {
        const codeLines = (token.text || "").split("\n");
        for (const codeLine of codeLines) {
          const styled = isErrorBox
            ? `\x1b[38;2;255;120;120m${codeLine}\x1b[0m`
            : this.theme.codeBlock
            ? this.theme.codeBlock(codeLine)
            : codeLine;
          const safeStyled = styled.replace(/\x1b\[0m/g, `\x1b[0m${CODE_BG}`);
          lines.push(styleBlockLine(`${indent}${safeStyled}`));
        }
      }

      lines.push(bottomRow());

      if (nextTokenType && nextTokenType !== "space") {
        lines.push("");
      }
      return lines;
    }

    return origRenderToken.call(this, token, width, nextTokenType, styleContext);
  };
}

/**
 * Parchea AssistantMessageComponent e InteractiveMode para que los errores
 * del asistente y los avisos de reintento/fallos de sistema se rendericen
 * en una caja Markdown de error estilizada con ☠️.
 */
function installErrorBoxPatch(): void {
  // 1. Parche en AssistantMessageComponent (para cuando la respuesta de la IA termina en error)
  const assistantProto = AssistantMessageComponent?.prototype as Record<symbol | string, any> | undefined;
  if (assistantProto) {
    if (!assistantProto[ORIG_ASSISTANT_UPDATE]) {
      assistantProto[ORIG_ASSISTANT_UPDATE] = assistantProto.updateContent;
    }

    const origUpdateContent = assistantProto[ORIG_ASSISTANT_UPDATE];
    assistantProto.updateContent = function (message: any, isStreaming?: boolean): void {
      origUpdateContent.call(this, message, isStreaming);

      if (!codeBoxEnabled) return;

      const hasToolCalls = message?.content?.some((c: any) => c.type === "toolCall");
      if (!hasToolCalls && message?.stopReason === "error") {
        const lastChild = this.contentContainer?.children?.[this.contentContainer.children.length - 1];
        if (lastChild instanceof Text) {
          // Reemplazar el Text plano de error por un Markdown con fence ```error
          const rawError = message.errorMessage || "Unknown error";
          const formatted = prettifyErrorContent(rawError);
          const mdText = `\`\`\`error\n${formatted}\n\`\`\``;
          this.contentContainer.children[this.contentContainer.children.length - 1] = new Markdown(
            mdText,
            this.outputPad ?? 1,
            0,
            this.markdownTheme
          );
        }
      }
    };
  }

  // 2. Parche en InteractiveMode.prototype.showError (para reintentos, fallos 503/429 y errores de loop)
  const interactiveProto = (InteractiveMode as unknown as { prototype?: Record<symbol | string, any> })?.prototype;
  if (interactiveProto) {
    if (!interactiveProto[ORIG_SHOW_ERROR]) {
      interactiveProto[ORIG_SHOW_ERROR] = interactiveProto.showError;
    }

    interactiveProto.showError = function (errorMessage: string): void {
      if (!codeBoxEnabled) {
        return interactiveProto[ORIG_SHOW_ERROR].call(this, errorMessage);
      }

      this.chatContainer.addChild(new Spacer(1));
      const formatted = prettifyErrorContent(errorMessage);
      const mdText = `\`\`\`error\n${formatted}\n\`\`\``;
      this.chatContainer.addChild(
        new Markdown(mdText, this.outputPad ?? 1, 0, this.getMarkdownThemeWithSettings?.())
      );
      this.ui.requestRender();
    };
  }
}

/**
 * Parchea AssistantMessageComponent para agregar una línea al final de toda
 * la respuesta con el botón [📋] para copiar la respuesta completa del agente.
 */
function installAssistantCopyPatch(): void {
  const proto = AssistantMessageComponent?.prototype as Record<symbol | string, any> | undefined;
  if (!proto) return;

  if (!proto[ORIG_ASSISTANT_RENDER]) {
    proto[ORIG_ASSISTANT_RENDER] = proto.render;
  }
  const origRender = proto[ORIG_ASSISTANT_RENDER];

  proto.render = function (width: number): string[] {
    const lines = origRender.call(this, width);
    if (!lines || lines.length <= 1) return lines;

    // Solo aplicar cuando el mensaje fue respondido exitosamente por el asistente
    // (no cuando hay error, abort o está en streaming sin finalizar)
    const msg = (this as any).lastMessage;
    if (!msg || msg.stopReason === "error" || msg.stopReason === "aborted") {
      return lines;
    }

    const copyBadge = " 📋 ";
    const copyBadgeLen = 4;
    const rightDashes = 3;
    const borderCol = "\x1b[38;2;255;77;77m"; // bloodMid
    const whiteCopy = `\x1b[38;2;255;255;255m${copyBadge}\x1b[0m`;

    // Localizar la última línea visible (borde inferior)
    let lastIdx = lines.length - 1;
    while (lastIdx >= 0 && !lines[lastIdx]?.trim()) {
      lastIdx--;
    }
    if (lastIdx < 0) return lines;

    const bottomLine = lines[lastIdx]!;
    const plainBottom = bottomLine.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]133;[A-Z]\x07/g, "").trim();

    // Caso 1: Tiene el borde inferior redondeado DC-BOX (╰─────────╯)
    if (plainBottom.startsWith("╰") && plainBottom.endsWith("╯")) {
      const boxW = visibleWidth(plainBottom) - 2;
      const bottomDashes = Math.max(0, boxW - copyBadgeLen - rightDashes);
      const newBottom = `${borderCol}╰${"─".repeat(bottomDashes)}${whiteCopy}${borderCol}${"─".repeat(rightDashes)}╯\x1b[0m`;

      // Preservar marcadores OSC133 tanto al inicio como al final de la línea
      const oscStartMatch = bottomLine.match(/^(\x1b\]133;[A-Z]\x07)+/);
      const oscPrefix = oscStartMatch ? oscStartMatch[0] : "";
      const oscEndMatch = bottomLine.match(/(\x1b\]133;[A-Z]\x07)+$/);
      const oscSuffix = oscEndMatch ? oscEndMatch[0] : "";

      lines[lastIdx] = oscPrefix + newBottom + oscSuffix;

      (this as any)[LAST_ASSISTANT_COPY] = {
        y: lastIdx,
        startX: boxW - copyBadgeLen - rightDashes,
      };
    } else {
      // Caso 2: Mensaje sin caja exterior -> badge discreto a la derecha sin marco roto
      const rightPad = 2;
      const copyBadgeWithBorder = `${borderCol}[${whiteCopy}${borderCol}]${"\x1b[0m"}`;
      const badgeVisibleW = copyBadgeLen + 2;
      const leftSpaces = Math.max(0, width - badgeVisibleW - rightPad);
      const badgeLine = " ".repeat(leftSpaces) + copyBadgeWithBorder;
      lines.push(badgeLine);

      (this as any)[LAST_ASSISTANT_COPY] = {
        y: lines.length - 1,
        startX: leftSpaces,
      };
    }

    return lines;
  };

  if (!proto[ORIG_ASSISTANT_MOUSE]) {
    proto[ORIG_ASSISTANT_MOUSE] = proto.handleMouse;
  }
  const origMouse = proto[ORIG_ASSISTANT_MOUSE];

  proto.handleMouse = function (event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "click" && (event.button ?? "left") === "left") {
      const copyRegion = (this as any)[LAST_ASSISTANT_COPY];
      if (copyRegion && event.y === copyRegion.y && event.x >= copyRegion.startX) {
        const message = (this as any).lastMessage;
        let fullText = "";
        if (message?.content && Array.isArray(message.content)) {
          fullText = message.content
            .filter((c: any) => c.type === "text" && c.text)
            .map((c: any) => c.text)
            .join("\n\n");
        }
        if (fullText) {
          copyToClipboard(fullText);
          notifyHerdr("📋 Portapapeles", "Copiada respuesta del asistente");
          return { handled: true };
        }
      }
    }
    return origMouse?.call(this, event);
  };
}

function createAgentResultRenderer(isStale: boolean) {
  return (message: any, options: { expanded: boolean; outputPad?: number }, theme: any) => {
    const details = (message.details as any)?.gentleAgents ?? (message as any).data;
    const agent = details?.agent || "subagent";
    const status = details?.status || "completed";
    const taskId = details?.taskId || "";
    const label = details?.label || "";

    const content = message.content ?? (message as any).data?.content;
    let fullText = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((p: any) => (p.type === "text" ? (p.text ?? "") : "")).join("\n")
        : String(content ?? "");

    if (!fullText.trim() && isStale) {
      fullText = `Subagent ${agent} (task ${taskId}, "${label}") finished while the orchestrator was busy.\nMarked stale: the result was not replayed into the conversation.`;
    }

    const isSuccess = status === "completed" || !status;
    const borderCol = isSuccess ? "\x1b[38;2;255;77;77m" : "\x1b[38;2;255;50;50m";
    const tagAnsi = isSuccess ? "\x1b[38;2;255;51;51m" : "\x1b[38;2;255;50;50m";
    const CARD_BG = "\x1b[48;2;26;13;16m";
    const reset = "\x1b[0m";

    const glyph = "👨‍💼";
    const titleText = ` ${glyph}  ${isStale ? "Stale agent result" : "Agent result"} · ${agent} `;
    const styledTitle = `\x1b[1m${tagAnsi}${titleText}${reset}`;

    let copyRegion: { y: number; startX: number } | null = null;

    return {
      render(width: number): string[] {
        const cardW = width;
        const innerW = Math.max(4, cardW - 4);
        const sideBorder = `${borderCol}│${reset}`;

        const styleCardLine = (lineContent: string): string => {
          const v = visibleWidth(lineContent);
          const cell = v > innerW ? truncateToWidth(lineContent, innerW, "") : lineContent + " ".repeat(Math.max(0, innerW - v));
          const row = `${sideBorder} ${cell} ${sideBorder}`;
          const pres = row.replace(/\x1b\[0m/g, `\x1b[0m${CARD_BG}`).replace(/\x1b\[49m/g, CARD_BG);
          return `${CARD_BG}${pres}\x1b[0m`;
        };

        const arrowSymbol = options.expanded ? "▲" : "▼";
        const arrowBadge = ` ${arrowSymbol} `;
        const arrowLen = visibleWidth(arrowBadge);
        const rightDashes = 3;

        let titleStr = titleText;
        let styledT = styledTitle;
        const maxTitleW = Math.max(1, cardW - 3 - arrowLen - rightDashes);
        if (visibleWidth(titleStr) > maxTitleW) {
          titleStr = truncateToWidth(titleStr, maxTitleW, "");
          styledT = `\x1b[1m${tagAnsi}${titleStr}${reset}`;
        }
        const titleW = visibleWidth(titleStr);

        const topDashes = Math.max(0, cardW - 3 - titleW - arrowLen - rightDashes);
        const whiteArrow = `\x1b[38;2;255;255;255m${arrowBadge}\x1b[0m`;
        const topBorder = `${borderCol}╭─${styledT}${borderCol}${"─".repeat(topDashes)}${whiteArrow}${borderCol}${"─".repeat(rightDashes)}╮${reset}`;

        const lines: string[] = [];
        const presTop = topBorder.replace(/\x1b\[0m/g, `\x1b[0m${CARD_BG}`).replace(/\x1b\[49m/g, CARD_BG);
        lines.push(`${CARD_BG}${presTop}\x1b[0m`);

        if (!options.expanded) {
          let summaryLine = "";
          const rawLines = fullText.split("\n");
          for (const line of rawLines) {
            const t = line.trim();
            if (!t) continue;
            if (t.toLowerCase().startsWith("summary:")) {
              summaryLine = t.slice(8).trim();
              break;
            }
          }
          if (!summaryLine) {
            for (const line of rawLines) {
              const t = line.trim();
              if (!t) continue;
              if (t.startsWith("#") || t.toLowerCase().startsWith("status:")) continue;
              summaryLine = t;
              break;
            }
          }
          if (!summaryLine) {
            summaryLine = `[ subagent ${agent} (task ${taskId}, "${label}") finished ]`;
          }
          lines.push(styleCardLine(summaryLine));
        } else {
          const fallbackMdTheme = {
            heading: (s: string) => (theme?.fg ? theme.fg("mdHeading", s) : s),
            link: (s: string) => (theme?.fg ? theme.fg("mdLink", s) : s),
            linkUrl: (s: string) => (theme?.fg ? theme.fg("mdLinkUrl", s) : s),
            code: (s: string) => (theme?.fg ? theme.fg("mdCode", s) : s),
            codeBlock: (s: string) => (theme?.fg ? theme.fg("mdCodeBlock", s) : s),
            codeBlockBorder: (s: string) => (theme?.fg ? theme.fg("mdCodeBlockBorder", s) : s),
            quote: (s: string) => (theme?.fg ? theme.fg("mdQuote", s) : s),
            quoteBorder: (s: string) => (theme?.fg ? theme.fg("mdQuoteBorder", s) : s),
            hr: (s: string) => (theme?.fg ? theme.fg("mdHr", s) : s),
            listBullet: (s: string) => (theme?.fg ? theme.fg("mdListBullet", s) : s),
            bold: (s: string) => (theme?.bold ? theme.bold(s) : `\x1b[1m${s}\x1b[22m`),
            italic: (s: string) => (theme?.italic ? theme.italic(s) : `\x1b[3m${s}\x1b[23m`),
            underline: (s: string) => (theme?.underline ? theme.underline(s) : `\x1b[4m${s}\x1b[24m`),
            strikethrough: (s: string) => `\x1b[9m${s}\x1b[29m`,
            codeBlockIndent: "  ",
          };

          const mdTheme = activeUiTheme?.markdownTheme || (theme as any)?.markdownTheme || fallbackMdTheme;
          const md = new Markdown(fullText, 0, 0, mdTheme);
          const mdRendered = md.render(innerW);
          if (mdRendered.length === 0) {
            lines.push(styleCardLine(""));
          } else {
            for (const line of mdRendered) {
              lines.push(styleCardLine(line));
            }
          }
        }

        const copyBadge = " 📋 ";
        const copyBadgeLen = 4;
        const whiteCopy = `\x1b[38;2;255;255;255m${copyBadge}\x1b[0m`;
        const bottomDashes = Math.max(0, cardW - 2 - copyBadgeLen - 3);
        const bottomBorder = `${borderCol}╰${"─".repeat(bottomDashes)}${whiteCopy}${borderCol}${"─".repeat(3)}╯${reset}`;
        const presBottom = bottomBorder.replace(/\x1b\[0m/g, `\x1b[0m${CARD_BG}`).replace(/\x1b\[49m/g, CARD_BG);
        lines.push(`${CARD_BG}${presBottom}\x1b[0m`);

        copyRegion = {
          y: lines.length - 1,
          startX: 1 + bottomDashes,
        };

        return lines;
      },
      handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
        if (event.type === "click" && (event.button ?? "left") === "left") {
          if (copyRegion && event.y === copyRegion.y && event.x >= copyRegion.startX) {
            copyToClipboard(fullText);
            notifyHerdr("📋 Portapapeles", "Copiado resultado de " + agent);
            return { handled: true };
          }
        }
        return undefined;
      },
      invalidate(): void {},
    };
  };
}

export function installAgentResultRenderers(pi: ExtensionAPI): void {
  const resultRenderer = createAgentResultRenderer(false);
  const staleResultRenderer = createAgentResultRenderer(true);

  try {
    pi.registerMessageRenderer("gentle-agents.result", resultRenderer);
  } catch {
    /* noop */
  }

  try {
    pi.registerMessageRenderer("gentle-agents.stale-result", staleResultRenderer);
  } catch {
    /* noop */
  }

  if (typeof (pi as any).registerEntryRenderer === "function") {
    try {
      (pi as any).registerEntryRenderer("gentle-agents.stale-result", staleResultRenderer);
    } catch {
      /* noop */
    }
  }

  const runnerProto = (ExtensionRunner as unknown as { prototype?: Record<symbol | string, any> })?.prototype;
  if (runnerProto) {
    if (!runnerProto[ORIG_RUNNER_GET_MSG_RENDERER]) {
      runnerProto[ORIG_RUNNER_GET_MSG_RENDERER] = runnerProto.getMessageRenderer;
    }
    const origGetMsgRenderer = runnerProto[ORIG_RUNNER_GET_MSG_RENDERER];
    runnerProto.getMessageRenderer = function (customType: string) {
      if (customType === "gentle-agents.result") {
        return resultRenderer;
      }
      if (customType === "gentle-agents.stale-result") {
        return staleResultRenderer;
      }
      return origGetMsgRenderer.call(this, customType);
    };

    if (!runnerProto[ORIG_RUNNER_GET_ENTRY_RENDERER] && typeof runnerProto.getEntryRenderer === "function") {
      runnerProto[ORIG_RUNNER_GET_ENTRY_RENDERER] = runnerProto.getEntryRenderer;
      const origGetEntryRenderer = runnerProto[ORIG_RUNNER_GET_ENTRY_RENDERER];
      runnerProto.getEntryRenderer = function (customType: string) {
        if (customType === "gentle-agents.stale-result") {
          return staleResultRenderer;
        }
        return origGetEntryRenderer.call(this, customType);
      };
    }
  }
}

export default function dcMarkdownExtension(pi: ExtensionAPI): void {
  installPatch();
  installErrorBoxPatch();
  installAssistantCopyPatch();
  installAgentResultRenderers(pi);

  pi.on("session_start", (_event, ctx) => {
    if (ctx?.ui?.theme) activeUiTheme = ctx.ui.theme;
    installPatch();
    installErrorBoxPatch();
    installAssistantCopyPatch();
    installAgentResultRenderers(pi);
  });

  pi.on("turn_start", (_event, ctx) => {
    if (ctx?.ui?.theme) activeUiTheme = ctx.ui.theme;
  });

  pi.registerCommand("markdown-box", {
    description: "Alternar cajas estilizadas de código en Markdown (/markdown-box [on|off])",
    handler: async (args: string, ctx: ExtensionContext) => {
      const trimmed = (args ?? "").trim().toLowerCase();
      if (!trimmed) {
        ctx.ui.notify(`markdown-box: ${codeBoxEnabled ? "activado" : "desactivado"}`, "info");
        return;
      }
      if (trimmed === "off" || trimmed === "0") {
        codeBoxEnabled = false;
        (ctx.ui as any).requestRender?.();
        ctx.ui.notify("markdown-box: desactivado", "info");
        return;
      }
      if (trimmed === "on" || trimmed === "1") {
        codeBoxEnabled = true;
        (ctx.ui as any).requestRender?.();
        ctx.ui.notify("markdown-box: activado", "info");
        return;
      }
      ctx.ui.notify("Uso: /markdown-box [on | off]", "warning");
    },
  });
}
