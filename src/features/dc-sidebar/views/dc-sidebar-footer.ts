import type { Component, TUI } from "@earendil-works/pi-tui";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import { FRAME, SidebarState } from "../core/dc-sidebar-types.ts";
import { coloredFrame } from "./dc-sidebar-header.ts";

export const BIG_DEFAULT: readonly string[] = [
  "   ~~~~~~~~~~~~~~~~~~~   ",
  "  /~~~~~~~~~~~~~~~~~~~\\  ",
  " |~~        ~        ~~| ",
  " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
  " │  ╔═════╗   ╔═════╗  │ ",
  " │══║  ♥  ║═══║  ♥  ║══│ ",
  " │  ╚═════╝   ╚═════╝  │ ",
  " │          ╩          │ ",
  "  \\                   /  ",
  "   \\    ╘═══════╛    /   ",
  "    \\     #####     /    ",
  "     └─────###─────┘     ",
];

export function paintBigLine(line: string, fg: (role: string, text: string) => string): string {
  return Array.from(line)
    .map((ch, idx) => {
      let role = "accent";
      const isOuter =
        ch === "┌" ||
        ch === "┐" ||
        ch === "└" ||
        ch === "┘" ||
        (ch === "─" && (line.trim().startsWith("┌") || line.trim().startsWith("└"))) ||
        (ch === "│" && (idx === 0 || idx === line.length - 1));
      if (isOuter) role = "error";
      else if ("~".includes(ch)) role = "text";
      else if ("▲".includes(ch)) role = "error";
      else if ("╔║╚╞╒╝╗╛╕╜╖".includes(ch)) role = "text";
      else if ("═".includes(ch) && line.includes("╔")) role = "text";
      else if ("♥".includes(ch)) role = "error";
      else if ("■♦≡".includes(ch)) role = "accent";
      else if ("╩‖".includes(ch)) role = "muted";
      else if ("╘╬╕╒«»═╝╗╛╜╖".includes(ch)) role = "text";
      else if ("#".includes(ch)) role = "error";
      else if ("zZ".includes(ch)) role = "muted";
      else if ("?!".includes(ch)) role = "warning";
      return fg(role, ch);
    })
    .join("");
}

export interface SidebarFooterOptions {
  faceText?: string;
  statusText?: string;
  onFaceClick?: () => void;
}

const G_SIDEBAR_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");

function stateOf(tui: any): SidebarState | undefined {
  return tui?.terminal?.[G_SIDEBAR_STATE];
}

/**
 * Footer del sidebar:
 * - Inamovible abajo.
 * - Con el tamaño del dc-face de lab (12 líneas de Big ASCII Face + status label).
 * - Toma la parte "face" si gentle-pi / dc-face está activo, o usa el Big Face por defecto.
 */
export function createSidebarFooter(tui: any, totalWidth: number, options: SidebarFooterOptions = {}): Component {
  const innerWidth = Math.max(0, totalWidth - 2);
  const b = (s: string) => coloredFrame(tui, s);

  const fallbackFg = (role: string, text: string) => {
    try {
      const theme = tui?.theme || (tui?.terminal as any)?.theme;
      if (theme && typeof theme.fg === "function") {
        return theme.fg(role as any, text);
      }
    } catch {
      /* noop */
    }
    if (role === "error") return `\x1b[38;2;255;51;51m${text}\x1b[0m`;
    if (role === "accent") return `\x1b[38;2;255;77;77m${text}\x1b[0m`;
    if (role === "text") return `\x1b[38;2;255;204;204m${text}\x1b[0m`;
    if (role === "muted") return `\x1b[2;38;2;180;180;180m${text}\x1b[0m`;
    return text;
  };

  const center = (txt: string, w: number): string => {
    const v = visibleWidth(txt);
    if (v >= w) return truncateToWidth(txt, w, "");
    const left = Math.floor((w - v) / 2);
    const right = w - v - left;
    return " ".repeat(left) + txt + " ".repeat(right);
  };

  return {
    render(width: number): string[] {
      const w = width > 0 ? width : innerWidth;
      const sepLine = b(FRAME.h.repeat(w));

      // 1. Si gentle-pi o dc-face montó la parte "face", tomarla de ahí como en lab:
      try {
        const liveFaceComp = stateOf(tui)?.parts?.get("face");
        if (liveFaceComp && typeof liveFaceComp.render === "function") {
          const rawLines = liveFaceComp.render(w) as string[];
          if (Array.isArray(rawLines) && rawLines.length > 0) {
            return [sepLine, ...rawLines.map((l) => l.replace(/\u2503/g, ""))];
          }
        }
      } catch {
        /* fallback al Big Face local */
      }

      // 2. Si no hay parte "face", renderizar el Big Face idéntico a lab:
      const faceLines = BIG_DEFAULT.map((line) => {
        const painted = paintBigLine(line, fallbackFg);
        return center(painted, w);
      });

      const labelText =
        fallbackFg("accent", "● listo ○ tts ") +
        fallbackFg("muted", "[dcdev]");
      const centeredLabel = center(labelText, w);

      return [
        sepLine,
        "",
        ...faceLines,
        "",
        centeredLabel,
      ];
    },

    invalidate() {
      try {
        stateOf(tui)?.parts?.get("face")?.invalidate?.();
      } catch {
        /* noop */
      }
    },

    handleMouse(event: any): any {
      if (event?.type === "click" && (event.button ?? "left") === "left") {
        const fn = (globalThis as any)[Symbol.for("dc.face.demo")];
        if (typeof fn === "function") {
          fn();
          return { handled: true };
        }
        options.onFaceClick?.();
        return { handled: true };
      }
      return undefined;
    },
  };
}
