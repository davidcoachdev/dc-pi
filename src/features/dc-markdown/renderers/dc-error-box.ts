import {
  AssistantMessageComponent,
  InteractiveMode,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { prettifyErrorContent } from "../core/dc-markdown-tokens.ts";
import { isCodeBoxEnabled } from "../core/dc-markdown-config.ts";

export const ORIG_ASSISTANT_UPDATE = Symbol.for("dc.assistant-message.orig-update-content");
export const ORIG_SHOW_ERROR = Symbol.for("dc.interactive-mode.orig-show-error");

/**
 * Parchea AssistantMessageComponent e InteractiveMode para que los errores
 * del asistente y los avisos de reintento/fallos de sistema (503/429/etc.)
 * se rendericen en una caja Markdown de error estilizada con ☠️.
 */
export function installErrorBoxPatch(): boolean {
  // 1. Parche en AssistantMessageComponent (para cuando la respuesta de la IA termina en error)
  const assistantProto = (AssistantMessageComponent as any)?.prototype as Record<symbol | string, any> | undefined;
  if (assistantProto) {
    if (!assistantProto[ORIG_ASSISTANT_UPDATE]) {
      assistantProto[ORIG_ASSISTANT_UPDATE] = assistantProto.updateContent;
    }

    const origUpdateContent = assistantProto[ORIG_ASSISTANT_UPDATE];
    assistantProto.updateContent = function (message: any, isStreaming?: boolean): void {
      origUpdateContent.call(this, message, isStreaming);

      if (!isCodeBoxEnabled()) return;

      const hasToolCalls = message?.content?.some((c: any) => c.type === "toolCall");
      if (!hasToolCalls && message?.stopReason === "error") {
        const lastChild = this.contentContainer?.children?.[this.contentContainer.children.length - 1];
        if (lastChild instanceof Text) {
          const rawError = message.errorMessage || "Unknown error";
          const formatted = prettifyErrorContent(rawError);
          const mdText = `\`\`\`error\n${formatted}\n\`\`\``;
          this.contentContainer.children[this.contentContainer.children.length - 1] = new Markdown(
            mdText,
            this.outputPad ?? 1,
            0,
            this.markdownTheme,
          );
        }
      }
    };
  }

  // 2. Parche en InteractiveMode.prototype.showError (para reintentos, fallos 503/429 y errores de loop)
  const interactiveProto = (InteractiveMode as any)?.prototype as Record<symbol | string, any> | undefined;
  if (interactiveProto) {
    if (!interactiveProto[ORIG_SHOW_ERROR]) {
      interactiveProto[ORIG_SHOW_ERROR] = interactiveProto.showError;
    }

    interactiveProto.showError = function (errorMessage: string): void {
      if (!isCodeBoxEnabled()) {
        return interactiveProto[ORIG_SHOW_ERROR].call(this, errorMessage);
      }

      this.chatContainer.addChild(new Spacer(1));
      const formatted = prettifyErrorContent(errorMessage);
      const mdText = `\`\`\`error\n${formatted}\n\`\`\``;
      this.chatContainer.addChild(
        new Markdown(mdText, this.outputPad ?? 1, 0, this.getMarkdownThemeWithSettings?.()),
      );
      this.ui.requestRender();
    };
  }

  return true;
}
