import { visibleWidth } from "@earendil-works/pi-tui";
import { agentVisualStateStore, type AgentState } from "../../../core/dc-agent-state/index.ts";

export const ANSI_RE = /\x1b\[[0-9;]*m/g;
export const stripAnsi = (s: string): string => s.replace(ANSI_RE, "").trim();

export const BRAND_RE = /[✿❋❀✽✾]\s*gentle-pi/g;
export const BRAND_TEXT = "⛩  Dc Studio";
export const BAR_SEPARATOR = "\u27E1"; // ⟡
export const FACE_KEY = Symbol.for("dc.face.mini");

export interface BottomBarBoxes {
  /** Left box: Brand (⛩  Dc Studio) + Location / Git branch */
  left: string;
  /** Center box: MCPs, Session name, or secondary status */
  center: string;
  /** Right box: Reactive Kaomoji face indicator */
  right: string;
}

/**
 * Checks if a cleaned token is redundant with dc-prompt (Model, Effort, Context gauge, Cost).
 */
export function isRedundantSegment(clean: string): boolean {
  if (!clean) return true;

  // 1. Model / Effort (e.g. ac05/gemini-3.8-flash-high · medium)
  if (
    clean.includes(" · high") ||
    clean.includes(" · medium") ||
    clean.includes(" · low") ||
    clean.includes(" · max") ||
    clean.includes(" · off") ||
    (/\b[a-z0-9_-]+\/[a-z0-9._-]+\b/i.test(clean) && !clean.includes("~") && !clean.includes("/"))
  ) {
    return true;
  }

  // 2. Context gauge (e.g. ctx ▰▰▰▱▱▱▱ 53% or block bars)
  if (
    clean.toLowerCase().startsWith("ctx") ||
    clean.includes("▰") ||
    clean.includes("▱") ||
    clean.includes("█") ||
    clean.includes("░")
  ) {
    return true;
  }

  // 3. Cost (e.g. $36.07 or $0.084 sub)
  if (clean.startsWith("$") || clean.endsWith("sub") || /^\$?\d+\.\d{2,3}/.test(clean)) {
    return true;
  }

  return false;
}

/**
 * Checks if a segment contains a kaomoji face or agent status.
 */
export function isFaceSegment(clean: string): boolean {
  if (!clean) return false;
  return (
    clean.includes("( -_- )") ||
    clean.includes("(-_-)") ||
    clean.includes("(•‿•)") ||
    clean.includes("(・_・)") ||
    /\([ \-_^.oO•◕◉❂‿◒◓]+[ \-_^.oO•◕◉❂‿]*\)/.test(clean) ||
    /[❂≖◔ʘ]|zzZ/.test(clean) ||
    /(?:dormido|feliz|pensando|escribiendo|trabajando|compactando|reintentando|hablando|permiso|pregunta|listo|idle)/i.test(clean)
  );
}

/**
 * Retrieves the current reactive mini kaomoji face from global state or AgentVisualStateStore.
 */
export function getCurrentMiniFace(theme?: { fg: (color: string, text: string) => string }): string {
  // 1. Global state hook
  const faceGlobal = (globalThis as any)[FACE_KEY];
  if (faceGlobal && typeof faceGlobal === "string" && faceGlobal.trim() !== "") {
    return theme ? theme.fg("accent", faceGlobal) : faceGlobal;
  }

  // 2. Agent visual store fallback
  const state: AgentState = agentVisualStateStore.getState() ?? "idle";
  const miniFaces: Record<AgentState, string> = {
    idle: "(•‿•) idle",
    typing: "^( '-' )^ typing",
    thinking: "( ≖.≖ ) thinking",
    writing: "m(◔◡◔)m writing",
    working: "<( '-' <) working",
    retying: "( ◐.̃◐ ) retry",
    compacting: "( ◐.◐ ) compacting",
    prompting: "( ◐‿◐ )?",
    talking: "( ʘoʘ ) talking",
    dormant: "( -_- ) zZ",
  };
  const text = miniFaces[state] ?? "(•‿•) idle";
  return theme ? theme.fg("accent", text) : `\x1b[38;2;255;77;77m${text}\x1b[39m`;
}

/**
 * Builds the Left Box (Brand + Project location / Branch).
 */
export function buildLeftBox(brand: string = BRAND_TEXT, location?: string): string {
  if (!location || location.trim() === "") {
    return brand;
  }
  return `${brand} \x1b[2m·\x1b[22m ${location.trim()}`;
}

/**
 * Builds the Center Box (MCPs, Session name, or other auxiliary status).
 */
export function buildCenterBox(items: string[]): string {
  const valid = items.map((i) => i.trim()).filter((i) => i.length > 0);
  if (valid.length === 0) return "";
  return valid.join(" \x1b[2m·\x1b[22m ");
}

/**
 * Builds the Right Box (Mini face).
 */
export function buildRightBox(faceText?: string, theme?: { fg: (color: string, text: string) => string }): string {
  if (faceText && faceText.trim().length > 0) {
    return faceText.trim();
  }
  return getCurrentMiniFace(theme);
}

/**
 * Extracts and categorizes segments from a raw gentle-pi bottom bar line into 3 modular boxes.
 */
export function extractBottomBarBoxes(
  rawLine: string,
  theme?: { fg: (color: string, text: string) => string },
): BottomBarBoxes {
  // Rebrand gentle-pi to DC Studio brand
  const line = rawLine.replace(BRAND_RE, BRAND_TEXT);

  // Split tokens by separator ⟡ or wide spaces
  const rawParts = line.split(BAR_SEPARATOR).map((p) => p.trim()).filter(Boolean);
  const parts: string[] = [];
  for (const rp of rawParts) {
    const sub = rp.split(/\s{3,}/).map((s) => s.trim()).filter(Boolean);
    parts.push(...sub);
  }

  let brandSegment = BRAND_TEXT;
  let locationSegment = "";
  const centerSegments: string[] = [];
  let faceSegment = "";

  const faceGlobal = (globalThis as any)[FACE_KEY];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    const clean = stripAnsi(p);
    if (!clean) continue;

    // Check if it's the face
    if ((faceGlobal && clean.includes(stripAnsi(faceGlobal))) || isFaceSegment(clean)) {
      if (!faceSegment) {
        faceSegment = p;
      }
      continue;
    }

    // First item is typically the brand
    if (i === 0) {
      brandSegment = p.includes("Dc Studio") ? p : BRAND_TEXT;
      continue;
    }

    // Filter redundant segments
    if (isRedundantSegment(clean)) {
      continue;
    }

    // Second item is typically project location / git branch
    if (!locationSegment && (clean.includes("~") || clean.includes("/") || clean.includes("±") || clean.includes("master") || clean.includes("main"))) {
      locationSegment = p;
      continue;
    }

    // Other non-redundant items go to center box
    centerSegments.push(p);
  }

  const left = buildLeftBox(brandSegment, locationSegment);
  const center = buildCenterBox(centerSegments);
  const right = buildRightBox(faceSegment, theme);

  return { left, center, right };
}
