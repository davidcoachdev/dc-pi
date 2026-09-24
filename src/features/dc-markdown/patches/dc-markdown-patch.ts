import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { Markdown, visibleWidth, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { dcClipboard } from "../../../integrations/dc-clipboard/dc-clipboard.ts";
import { dcNotifier } from "../../../integrations/dc-notify/dc-notifier.ts";
import { isCodeBoxEnabled } from "../core/dc-markdown-config.ts";
import { getHeadingPrefix } from "../core/dc-markdown-tokens.ts";
import { codeBlockCollapseState, getStoredCodeBlock } from "../core/dc-markdown-store.ts";
import { renderCodeBlockBox } from "../renderers/dc-code-block-box.ts";

export const ORIG_RENDER_TOKEN = Symbol.for("dc.markdown.orig-render-token");
export const ORIG_ASSISTANT_RENDER = Symbol.for("dc.assistant-message.orig-render");
export const ORIG_ASSISTANT_MOUSE = Symbol.for("dc.assistant-message.orig-handle-mouse");
export const LAST_ASSISTANT_COPY = Symbol.for("dc.assistant-message.last-copy-region");
export const CODE_BLOCK_REGIONS = Symbol.for("dc.assistant-message.code-block-regions");

let activeUiTheme: any = null;

export function setActiveUiTheme(theme: any): void {
  activeUiTheme = theme;
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

  const orig = proto[ORIG_RENDER_TOKEN];

  proto.renderToken = function (
    token: any,
    width: number,
    nextTokenType: string | undefined,
    styleContext: any,
  ): string[] {
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
      const prefix = getHeadingPrefix(headingLevel);
      const styledHeading = headingStyleFn(prefix) + headingText;

      const lines = [styledHeading];
      if (nextTokenType && nextTokenType !== "space") {
        lines.push("");
      }
      return lines;
    }

    if (token.type === "code" && isCodeBoxEnabled()) {
      const blockW = Math.max(8, width > 40 ? width - 2 : width);
      if (blockW < 20) {
        return orig.call(this, token, width, nextTokenType, styleContext);
      }

      const lines = renderCodeBlockBox({
        text: token.text || "",
        lang: token.lang,
        width,
        indent: this.theme?.codeBlockIndent ?? "  ",
        activeUiTheme,
        highlightCode: this.theme?.highlightCode?.bind(this.theme),
        codeBlockThemeFn: this.theme?.codeBlock?.bind(this.theme),
      });

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
 * Parchea AssistantMessageComponent para agregar copiado y colapso interactivo
 * de bloques individuales de código mediante marcadores APC invisibles.
 */
export function installAssistantCopyPatch(): boolean {
  const proto = (AssistantMessageComponent as any)?.prototype as Record<symbol | string, any> | undefined;
  if (!proto) return false;

  if (!proto[ORIG_ASSISTANT_RENDER]) {
    proto[ORIG_ASSISTANT_RENDER] = proto.render;
    proto[ORIG_ASSISTANT_MOUSE] = proto.handleMouse;
  }

  const origRender = proto[ORIG_ASSISTANT_RENDER];
  const origHandleMouse = proto[ORIG_ASSISTANT_MOUSE];

  proto.render = function (width: number): string[] {
    const lines = origRender.call(this, width);
    if (!lines || lines.length <= 1) return lines;

    const codeBlockRegions: Array<{
      id: number;
      topY: number;
      bottomY: number;
      boxW: number;
      code: string;
      lang: string;
    }> = [];

    const topMarkerRegex = /\x1b_dc:code:(\d+):top\x1b\\/;
    const botMarkerRegex = /\x1b_dc:code:(\d+):bot\x1b\\/;

    for (let y = 0; y < lines.length; y++) {
      const line = lines[y] ?? "";
      const topMatch = line.match(topMarkerRegex);
      if (topMatch) {
        const id = parseInt(topMatch[1]!, 10);
        const topY = y;
        const boxW = visibleWidth(line.replace(/\x1b_dc:code:\d+:(?:top|bot)\x1b\\/g, ""));
        for (let by = y + 1; by < lines.length; by++) {
          const bLine = lines[by] ?? "";
          const botMatch = bLine.match(botMarkerRegex);
          if (botMatch && parseInt(botMatch[1]!, 10) === id) {
            const bottomY = by;
            const data = getStoredCodeBlock(id);
            if (data) {
              codeBlockRegions.push({
                id,
                topY,
                bottomY,
                boxW,
                code: data.code,
                lang: data.lang,
              });
            }
            y = bottomY;
            break;
          }
        }
      }
    }
    (this as any)[CODE_BLOCK_REGIONS] = codeBlockRegions;

    return lines;
  };

  proto.handleMouse = function (event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "click" && (event.button ?? "left") === "left") {
      const blockRegions = (this as any)[CODE_BLOCK_REGIONS];
      if (Array.isArray(blockRegions)) {
        for (const block of blockRegions) {
          // Clic en botón [ 📋 ] del bloque de código
          if (event.y === block.bottomY && event.x >= Math.max(10, block.boxW - 14)) {
            if (block.code) {
              void dcClipboard.copy(block.code.replace(/\r?\n$/, ""));
              dcNotifier.notifyHerdr("📋 Portapapeles", `Copiado código (${block.lang || "código"})`);
              return { handled: true };
            }
          }
          // Clic en flecha [ ▼ ] / [ ▲ ] del bloque de código
          if (event.y === block.topY && event.x >= Math.max(10, block.boxW - 14)) {
            const current = codeBlockCollapseState.get(block.id) ?? false;
            codeBlockCollapseState.set(block.id, !current);
            (globalThis as any)[Symbol.for("dc.sidebar.tui-ref")]?.requestRender?.();
            return { handled: true };
          }
        }
      }

      // Clic en botón global de copiar todo el mensaje
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
          dcNotifier.notifyHerdr("📋 Portapapeles", "Copiada respuesta del asistente");
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
