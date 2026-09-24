import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ExtensionRunner } from "@earendil-works/pi-coding-agent";
import { Markdown, truncateToWidth, visibleWidth, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { dcClipboard } from "../../../integrations/dc-clipboard/dc-clipboard.ts";
import { dcNotifier } from "../../../integrations/dc-notify/dc-notifier.ts";

export const ORIG_RUNNER_GET_MSG_RENDERER = Symbol.for("dc.extension-runner.orig-get-message-renderer");
export const ORIG_RUNNER_GET_ENTRY_RENDERER = Symbol.for("dc.extension-runner.orig-get-entry-renderer");

export function createAgentResultRenderer(isStale: boolean, getTheme?: () => any) {
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

          const activeTheme = getTheme?.() || (theme as any)?.markdownTheme || fallbackMdTheme;
          const mdTheme = activeTheme?.markdownTheme || activeTheme;
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
            void dcClipboard.copy(fullText);
            dcNotifier.notifyHerdr("📋 Portapapeles", "Copiado resultado de " + agent);
            return { handled: true };
          }
        }
        return undefined;
      },
      invalidate(): void {},
    };
  };
}

export function installAgentResultRenderers(pi: ExtensionAPI, getTheme?: () => any): void {
  const resultRenderer = createAgentResultRenderer(false, getTheme);
  const staleResultRenderer = createAgentResultRenderer(true, getTheme);

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
