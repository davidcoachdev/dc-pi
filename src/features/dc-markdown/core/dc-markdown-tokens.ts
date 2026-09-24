export const CARD_OPACITY = 0.50;

export const DC_PANEL_R = 13;
export const DC_PANEL_G = 13;
export const DC_PANEL_B = 13;

export const DEFAULT_BG = "\x1b[48;2;31;13;13m";
export const DEFAULT_BORDER = "\x1b[38;2;255;77;77m";
export const DEFAULT_TAG = "\x1b[38;2;255;51;51m";

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

export function strWidth(s: string): number {
  return (s || "").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b_[^\x1b]*\x1b\\/g, "").length;
}

export function getLangIcon(rawLang: string): string {
  const lang = (rawLang || "").trim().toLowerCase();
  return LANG_ICONS[lang] || "";
}

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

export function resolveColors(isErrorBox: boolean, activeUiTheme?: any) {
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

export function getHeadingPrefix(level: number): string {
  if (level === 3) return "◆ ";
  if (level === 4) return "▸ ";
  if (level > 4) return "▪ ";
  return "";
}

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
      /* noop */
    }
  }
  return raw;
}
