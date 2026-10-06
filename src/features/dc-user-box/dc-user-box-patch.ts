import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { dcClipboard } from "../../integrations/dc-clipboard/dc-clipboard.ts";
import { getUserName } from "../dc-user/dc-user-store.ts";

export const ORIG_RENDER = Symbol.for("dc.user-message.orig-render");
export const ORIG_HANDLE_MOUSE = Symbol.for("dc.user-message.orig-handle-mouse");
export const LAST_COPY_REGION = Symbol.for("dc.user-message.last-copy-region");

export const OSC133_ZONE_START = "\x1b]133;A\x07";
export const OSC133_ZONE_END = "\x1b]133;B\x07";
export const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

export interface DcUserBoxConfig {
  boxEnabled: boolean;
  verticalPadding: boolean;
}

const config: DcUserBoxConfig = {
  boxEnabled: true,
  verticalPadding: false,
};

export function isUserBoxEnabled(): boolean {
  return config.boxEnabled;
}

export function setUserBoxEnabled(enabled: boolean): void {
  config.boxEnabled = enabled;
}

export function isUserBoxVerticalPadding(): boolean {
  return config.verticalPadding;
}

export function setUserBoxVerticalPadding(enabled: boolean): void {
  config.verticalPadding = enabled;
}

export function resolveCurrentUserName(): string {
  const name = getUserName();
  return name.trim() || "User";
}

/**
 * Instala el formateador de cards redondeadas para prompts de usuario en UserMessageComponent.prototype.
 */
export function installUserBoxPatch(): boolean {
  const proto = (UserMessageComponent as any)?.prototype as Record<symbol | string, any> | undefined;
  if (!proto) return false;

  if (!proto[ORIG_RENDER]) {
    proto[ORIG_RENDER] = proto.render;
    proto[ORIG_HANDLE_MOUSE] = proto.handleMouse;
  }

  proto.render = function (width: number): string[] {
    const orig = (this as any)[ORIG_RENDER] ?? proto[ORIG_RENDER];

    if (!config.boxEnabled || width < 28) {
      return orig.call(this, width);
    }

    const marginW = width > 40 ? 1 : 0;
    const cardW = Math.max(8, width - marginW * 2);
    const innerW = Math.max(4, cardW - 4);
    const leftMargin = " ".repeat(marginW);
    const rightMargin = leftMargin;

    // Detectar color de borde (mismo que bloques de código o rojo suave)
    const border = (s: string) => {
      if (this.markdownTheme?.codeBlockBorder) {
        return this.markdownTheme.codeBlockBorder(s);
      }
      return `\x1b[38;2;255;77;77m${s}\x1b[0m`;
    };
    const sideBorder = border("│");

    // Detectar fondo ANSI de userMessageBg
    let bgAnsi = "";
    try {
      const testSample = orig.call(this, 10);
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

    // Título superior con el nombre del usuario y glifo Torii
    const name = resolveCurrentUserName();
    const titleText = ` ⛩  ${name} `;
    const titleLen = visibleWidth(titleText);
    const dashesTotal = Math.max(0, cardW - 3 - titleLen);
    const rightDashes = 3;
    const leftDashes = Math.max(0, dashesTotal - rightDashes);

    const topBorder = border(`╭${"─".repeat(leftDashes)}${titleText}${"─".repeat(rightDashes)}╮`);

    const copyBadge = " 📋 ";
    const copyBadgeLen = visibleWidth(copyBadge);
    const bottomBorderRightDashes = 3;
    const bottomDashes = Math.max(0, cardW - 2 - copyBadgeLen - bottomBorderRightDashes);
    const whiteCopy = `\x1b[38;2;255;255;255m${copyBadge}\x1b[0m`;
    const bottomBorder = `${border(`╰${"─".repeat(bottomDashes)}`)}${whiteCopy}${border(`${"─".repeat(bottomBorderRightDashes)}╯`)}`;

    const topRow = `${leftMargin}${bgAnsi}${topBorder.replace(/\x1b\[0m/g, `\x1b[0m${bgAnsi}`)}\x1b[49m${rightMargin}`;
    const bottomRow = `${leftMargin}${bgAnsi}${bottomBorder.replace(/\x1b\[0m/g, `\x1b[0m${bgAnsi}`)}\x1b[49m${rightMargin}`;

    // Obtener líneas originales formateadas al ancho interno
    const rawLines: string[] = orig.call(this, innerW);
    const processedBody: string[] = [];

    let hasOsc133Start = false;
    let hasOsc133End = false;

    // Limpiar líneas de padding vacías producidas por el Box nativo de Pi
    let start = 0;
    while (start < rawLines.length) {
      const stripped = rawLines[start]!.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (stripped.length > 0) break;
      start++;
    }
    let end = rawLines.length - 1;
    while (end >= start) {
      const stripped = rawLines[end]!.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (stripped.length > 0) break;
      end--;
    }
    const cleanLines = start <= end ? rawLines.slice(start, end + 1) : (rawLines.length > 0 ? [rawLines[0]!] : [""]);

    for (let line of cleanLines) {
      if (line.includes(OSC133_ZONE_START)) {
        hasOsc133Start = true;
        line = line.replace(OSC133_ZONE_START, "");
      }
      if (line.includes(OSC133_ZONE_END)) {
        hasOsc133End = true;
        line = line.replace(OSC133_ZONE_END, "");
      }
      if (line.includes(OSC133_ZONE_FINAL)) {
        line = line.replace(OSC133_ZONE_FINAL, "");
      }

      const clean = line.replace(/\x1b\[48;2;[0-9;]+m/g, "").replace(/\x1b\[49m/g, "").trimEnd();
      const v = visibleWidth(clean);
      const cell = v > innerW ? truncateToWidth(clean, innerW, "") : clean + " ".repeat(Math.max(0, innerW - v));
      const row = `${sideBorder} ${cell} ${sideBorder}`;
      const pres = row.replace(/\x1b\[0m/g, `\x1b[0m${bgAnsi}`).replace(/\x1b\[49m/g, bgAnsi);
      processedBody.push(`${leftMargin}${bgAnsi}${pres}\x1b[49m${rightMargin}`);
    }

    if (config.verticalPadding) {
      const emptyRow = `${sideBorder} ${" ".repeat(innerW)} ${sideBorder}`;
      const pres = emptyRow.replace(/\x1b\[0m/g, `\x1b[0m${bgAnsi}`).replace(/\x1b\[49m/g, bgAnsi);
      const padLine = `${leftMargin}${bgAnsi}${pres}\x1b[49m${rightMargin}`;
      processedBody.unshift(padLine);
      processedBody.push(padLine);
    }

    (this as any)[LAST_COPY_REGION] = {
      y: processedBody.length + 1,
      startX: marginW + cardW - 1 - bottomBorderRightDashes - copyBadgeLen,
      endX: marginW + cardW,
    };

    const out: string[] = [topRow, ...processedBody, bottomRow];

    if (hasOsc133Start && out[0]) {
      out[0] = OSC133_ZONE_START + out[0];
    }
    if (hasOsc133End && out[out.length - 1]) {
      out[out.length - 1] = out[out.length - 1] + OSC133_ZONE_END;
    }

    return out;
  };

  proto.handleMouse = function (event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const marginW = event.width > 40 ? 2 : (event.width > 20 ? 1 : 0);

    // Clic en el botón 📋 copiar
    if (event.type === "click" && (event.button ?? "left") === "left") {
      const copyRegion = (this as any)[LAST_COPY_REGION];
      if (copyRegion && event.y === copyRegion.y && event.x >= copyRegion.startX) {
        let textToCopy = "";
        if (typeof (this as any).message?.content === "string") {
          textToCopy = (this as any).message.content;
        } else if (Array.isArray((this as any).message?.content)) {
          textToCopy = (this as any).message.content
            .map((c: any) => c.text ?? "")
            .join("\n");
        }

        if (textToCopy.trim()) {
          void dcClipboard.copy(textToCopy);
        }
        return { handled: true };
      }
    }

    const origMouse = (this as any)[ORIG_HANDLE_MOUSE] ?? proto[ORIG_HANDLE_MOUSE];
    if (typeof origMouse === "function") {
      const translated: TuiMouseEvent = {
        ...event,
        x: event.x - marginW - 2,
        y: event.y - 1,
        width: Math.max(4, event.width - marginW * 2 - 4),
      };
      return origMouse.call(this, translated);
    }
    return undefined;
  };

  return true;
}
