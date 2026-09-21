import { visibleWidth } from "@earendil-works/pi-tui";

export const CARD_OPACITY = 0.5;

export const DC_PANEL_R = 13;
export const DC_PANEL_G = 13;
export const DC_PANEL_B = 13;

export const DEFAULT_BG = "\x1b[48;2;31;13;13m"; // #1f0d0d (toolSuccessBg)
export const DEFAULT_BORDER = "\x1b[38;2;255;77;77m"; // #ff4d4d (bloodMid)
export const DEFAULT_TAG = "\x1b[38;2;255;51;51m"; // #ff3333 (bloodBright)

export const LANG_ICONS: Record<string, string> = {
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

/**
 * Mezcla un color de fondo ANSI RGB de 24 bits con el fondo oscuro (#0d0d0d) de DC Studio.
 */
export function blendWithBackground(colorAnsi: string, opacity: number = CARD_OPACITY): string {
  const match = colorAnsi.match(/48;2;(\d+);(\d+);(\d+)m/);
  if (!match) return colorAnsi;

  const r = parseInt(match[1]!, 10);
  const g = parseInt(match[2]!, 10);
  const b = parseInt(match[3]!, 10);

  const baseR = DC_PANEL_R;
  const baseG = DC_PANEL_G;
  const baseB = DC_PANEL_B;

  const blendedR = Math.round(r * opacity + baseR * (1 - opacity));
  const blendedG = Math.round(g * opacity + baseG * (1 - opacity));
  const blendedB = Math.round(b * opacity + baseB * (1 - opacity));

  return `\x1b[48;2;${blendedR};${blendedG};${blendedB}m`;
}

/**
 * Retorna el glifo limpio correspondiente al nivel de encabezado Markdown (H3: ◆, H4: ▸, H5+: ▪).
 */
export function getHeadingPrefix(level: number): string {
  if (level === 3) return "◆ ";
  if (level === 4) return "▸ ";
  if (level > 4) return "▪ ";
  return "";
}

/**
 * Obtiene el icono asociado al lenguaje de programación para bloques de código.
 */
export function getLangIcon(lang?: string): string {
  if (!lang) return "";
  const clean = lang.trim().toLowerCase();
  return LANG_ICONS[clean] ?? "";
}

/**
 * Parsea un mensaje de error para detectar JSONs incrustados (ej. respuestas de API 503/429)
 * y formatearlos con sangría limpia y espaciado de bloque.
 */
export function prettifyErrorContent(raw: string): string {
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
        const cleanPrefix = prefix.endsWith(":") ? prefix.slice(0, -1).trim() : prefix;
        if (cleanPrefix) parts.push(cleanPrefix);
      }
      parts.push(pretty);
      if (suffix) parts.push(suffix);
      return parts.join("\n\n");
    } catch {
      /* fallback a texto original */
    }
  }

  return raw;
}
