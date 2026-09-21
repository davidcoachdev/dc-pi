import {
  AssistantMessageComponent,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Markdown, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { dcClipboard } from "../../integrations/dc-clipboard/dc-clipboard.ts";
import {
  CARD_OPACITY,
  DEFAULT_BG,
  DEFAULT_BORDER,
  DEFAULT_TAG,
  blendWithBackground,
  getHeadingPrefix,
  getLangIcon,
  prettifyErrorContent,
} from "./dc-markdown-tokens.ts";

export const ORIG_RENDER_TOKEN = Symbol.for("dc.markdown.orig-render-token");
export const ORIG_ASSISTANT_UPDATE = Symbol.for("dc.assistant-message.orig-update-content");
export const ORIG_ASSISTANT_RENDER = Symbol.for("dc.assistant-message.orig-render");
export const ORIG_ASSISTANT_MOUSE = Symbol.for("dc.assistant-message.orig-handle-mouse");
export const LAST_ASSISTANT_COPY = Symbol.for("dc.assistant-message.last-copy-region");

export interface DcMarkdownConfig {
  codeBoxEnabled: boolean;
}

const config: DcMarkdownConfig = {
  codeBoxEnabled: true,
};

let activeUiTheme: any = null;

export function isCodeBoxEnabled(): boolean {
  return config.codeBoxEnabled;
}

export function setCodeBoxEnabled(enabled: boolean): void {
  config.codeBoxEnabled = enabled;
}

export function setActiveUiTheme(theme: any): void {
  activeUiTheme = theme;
}

function resolveColors(isErrorBox: boolean) {
  if (isErrorBox) {
    return {
      bgAnsi: blendWithBackground("\x1b[48;2;51;0;0m", 0.75),
      borderAnsi: "\x1b[38;2;255;0;0m",
      tagAnsi: "\x1b[38;2;255;51;51m",
    };
  }

  let bgAnsi = DEFAULT_BG;
  let borderAnsi = DEFAULT_BORDER;
  let tagAnsi = DEFAULT_TAG;

  if (activeUiTheme) {
    try {
      bgAnsi = activeUiTheme.getBgAnsi?.("toolSuccessBg") ?? DEFAULT_BG;
    } catch {
      bgAnsi = DEFAULT_BG;
    }

    try {
      borderAnsi =
        activeUiTheme.getFgAnsi?.("mdCodeBlockBorder") ||
        activeUiTheme.getFgAnsi?.("borderAccent") ||
        DEFAULT_BORDER;
    } catch {
      borderAnsi = DEFAULT_BORDER;
    }

    try {
      tagAnsi =
        activeUiTheme.getFgAnsi?.("accent") ||
        activeUiTheme.getFgAnsi?.("mdHeading") ||
        DEFAULT_TAG;
    } catch {
      tagAnsi = DEFAULT_TAG;
    }
  }

  bgAnsi = blendWithBackground(bgAnsi, CARD_OPACITY);
  return { bgAnsi, borderAnsi, tagAnsi };
}

/**
 * Instala el formateador de Markdown para headings y cajas de código redondeadas.
 */
export function installMarkdownPatch(): boolean {
  const proto = (Markdown as any)?.prototype as Record<symbol | string, any> | undefined;
  if (!proto) return false;

  if (!proto[ORIG_RENDER_TOKEN]) {
    proto[ORIG_RENDER_TOKEN] = proto.renderToken;
  }

  proto.renderToken = function (
    token: any,
    width: number,
    nextTokenType: string | undefined,
    styleContext: any,
  ): string[] {
    const orig = (this as any)[ORIG_RENDER_TOKEN] ?? proto[ORIG_RENDER_TOKEN];

    if (token.type === "heading") {
      const headingLevel = token.depth;
      let headingStyleFn: (text: string) => string;
      if (headingLevel === 1) {
        headingStyleFn = (text: string) =>
          this.theme?.heading ? this.theme.heading(this.theme.bold ? this.theme.bold(this.theme.underline ? this.theme.underline(text) : text) : text) : text;
      } else {
        headingStyleFn = (text: string) =>
          this.theme?.heading ? this.theme.heading(this.theme.bold ? this.theme.bold(text) : text) : text;
      }

      const prefix = getHeadingPrefix(headingLevel);
      const headingText = this.renderInlineTokens
        ? this.renderInlineTokens(token.tokens || [], {
            applyText: headingStyleFn,
            stylePrefix: this.getStylePrefix ? this.getStylePrefix(headingStyleFn) : "",
          })
        : token.text || "";

      const styledHeading = headingStyleFn(prefix) + headingText;
      const lines = [styledHeading];
      if (nextTokenType && nextTokenType !== "space") {
        lines.push("");
      }
      return lines;
    }

    if (token.type === "code" && config.codeBoxEnabled) {
      const marginW = width > 40 ? 1 : 0;
      const blockW = Math.max(8, width - marginW * 2);

      if (blockW < 20) {
        return orig.call(this, token, width, nextTokenType, styleContext);
      }

      const leftMargin = " ".repeat(marginW);
      const rightMargin = leftMargin;
      const innerCodeW = Math.max(4, blockW - 4);
      const indent = this.theme?.codeBlockIndent ?? "  ";

      const rawLang = (token.lang || "").trim().toLowerCase();
      const isErrorBox = rawLang === "error" || rawLang === "err";
      const { bgAnsi: CODE_BG, borderAnsi: borderCol, tagAnsi } = resolveColors(isErrorBox);

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
        titlePart = ` ☠️  Error `;
      } else if (rawLang && rawLang !== "text" && rawLang !== "txt") {
        const icon = getLangIcon(rawLang);
        titlePart = ` ${icon} ${rawLang} `;
      }

      const titleLen = titlePart ? visibleWidth(titlePart) : 0;
      const fillLen = Math.max(0, blockW - 3 - titleLen);
      const styledBadge = isErrorBox
        ? `\x1b[1m\x1b[38;2;255;80;80m${titlePart}\x1b[0m`
        : `\x1b[1m${tagAnsi}${titlePart}\x1b[0m`;

      const topBorder = titlePart
        ? `${borderCol}╭─${styledBadge}${borderCol}${"─".repeat(fillLen)}╮\x1b[0m`
        : `${borderCol}╭${"─".repeat(Math.max(0, blockW - 2))}╮\x1b[0m`;

      const topRow = `${leftMargin}${CODE_BG}${topBorder.replace(/\x1b\[0m/g, `\x1b[0m${CODE_BG}`)}\x1b[49m${rightMargin}`;

      let bottomBorder = "";
      if (isErrorBox) {
        const copyBadge = " 📋 ";
        const copyBadgeLen = visibleWidth(copyBadge);
        const rightDashes = 3;
        const bottomDashes = Math.max(0, blockW - 2 - copyBadgeLen - rightDashes);
        const whiteCopy = `\x1b[38;2;255;255;255m${copyBadge}\x1b[0m`;
        bottomBorder = `${borderCol}╰${"─".repeat(bottomDashes)}${whiteCopy}${borderCol}${"─".repeat(rightDashes)}╯\x1b[0m`;
      } else {
        const bottomDashes = Math.max(0, blockW - 2);
        bottomBorder = `${borderCol}╰${"─".repeat(bottomDashes)}╯\x1b[0m`;
      }
      const bottomRow = `${leftMargin}${CODE_BG}${bottomBorder.replace(/\x1b\[0m/g, `\x1b[0m${CODE_BG}`)}\x1b[49m${rightMargin}`;

      const lines: string[] = [];
      lines.push(topRow);

      if (!isErrorBox && this.theme?.highlightCode) {
        const highlightedLines = this.theme.highlightCode(token.text, token.lang);
        for (const hlLine of highlightedLines) {
          const safeHl = hlLine.replace(/\x1b\[0m/g, `\x1b[0m${CODE_BG}`);
          lines.push(styleBlockLine(`${indent}${safeHl}`));
        }
      } else {
        const codeLines = (token.text || "").split("\n");
        for (const codeLine of codeLines) {
          const styled = isErrorBox
            ? `\x1b[38;2;255;120;120m${codeLine}\x1b[0m`
            : this.theme?.codeBlock
            ? this.theme.codeBlock(codeLine)
            : codeLine;
          const safeStyled = styled.replace(/\x1b\[0m/g, `\x1b[0m${CODE_BG}`);
          lines.push(styleBlockLine(`${indent}${safeStyled}`));
        }
      }

      lines.push(bottomRow);

      if (nextTokenType && nextTokenType !== "space") {
        lines.push("");
      }
      return lines;
    }

    return orig.call(this, token, width, nextTokenType, styleContext);
  };

  return true;
}

/**
 * Parchea AssistantMessageComponent para agregar copiado y captura de cajas de error.
 */
export function installAssistantCopyPatch(): boolean {
  const proto = (AssistantMessageComponent as any)?.prototype as Record<symbol | string, any> | undefined;
  if (!proto) return false;

  if (!proto[ORIG_ASSISTANT_RENDER]) {
    proto[ORIG_ASSISTANT_RENDER] = proto.render;
    proto[ORIG_ASSISTANT_MOUSE] = proto.handleMouse;
  }

  const origHandleMouse = proto[ORIG_ASSISTANT_MOUSE];

  proto.handleMouse = function (event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "click" && (event.button ?? "left") === "left") {
      const copyRegion = (this as any)[LAST_ASSISTANT_COPY];
      if (copyRegion && event.y === copyRegion.y && event.x >= copyRegion.startX) {
        let textToCopy = "";
        const content = (this as any).message?.content;
        if (typeof content === "string") {
          textToCopy = content;
        } else if (Array.isArray(content)) {
          textToCopy = content
            .map((c: any) => c.text ?? "")
            .join("\n");
        }

        if (textToCopy.trim()) {
          void dcClipboard.copy(textToCopy);
        }
        return { handled: true };
      }
    }

    if (typeof origHandleMouse === "function") {
      return origHandleMouse.call(this, event);
    }
    return undefined;
  };

  return true;
}
