/**
 * Pure logic for dc-preamble: replace existing system preambles and normalize
 * four approved branding labels in structured prose, without mutating input.
 * Opaque content, cwd, non-string sections and non-system messages stay intact.
 */

export const DEFAULT_PREAMBLE = "You are an expert coding assistant.";

export interface SectionedSystemMessage {
  role: string;
  sections?: Record<string, unknown> | undefined;
}

const PROSE_LABELS: Record<string, string> = {
  "Pi documentation": "Documentation",
  "Pi SDK": "SDK",
  "Pi runtime": "runtime",
  "Pi-specific coding-agent harness": "coding-agent harness",
};

function normalizeProseLabels(text: string): string {
  // Protect Markdown indented lines (four spaces or a tab) and code spans/fences
  // first; match only exact prose phrases, not paths, packages or identifiers.
  // This conservative line guard is not a Markdown parser. No blanket pi removal.
  return text.replace(
    /^(?: {4}|\t)[^\r\n]*|(`+)[\s\S]*?\1|(~{3,})[\s\S]*?\2|(?<![\w/\\.@$-])(Pi documentation|Pi SDK|Pi runtime|Pi-specific coding-agent harness)(?![\w/\\@$-]|\.\w)/gm,
    (match, _backticks, _tildes, label: string | undefined) =>
      label ? PROSE_LABELS[label]! : match,
  );
}

export function replaceSystemPreambles<T extends SectionedSystemMessage>(
  messages: readonly T[],
  replacement: string,
): T[] {
  return messages.map((message) => {
    if (message.role !== "system" || !message.sections) return message;

    const sections = { ...message.sections };
    for (const [key, value] of Object.entries(sections)) {
      if (key === "preamble") {
        // Preserve the existing environment override contract verbatim.
        sections[key] = replacement;
      } else if (key !== "cwd" && typeof value === "string") {
        sections[key] = normalizeProseLabels(value);
      }
    }
    return { ...message, sections } as T;
  });
}

/**
 * Resolve the replacement text: `DC_PREAMBLE` environment override, falling
 * back to the built-in default.
 */
export function resolvePreambleReplacement(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.DC_PREAMBLE?.trim() || DEFAULT_PREAMBLE;
}
