/**
 * Pure logic for the dc-preamble feature: swap the `sections.preamble` of the
 * leading system message with a replacement, without creating missing sections
 * and without mutating the input messages.
 */

export const DEFAULT_PREAMBLE =
  "You are a coding assistant. Help users inspect files, run commands, and modify code.";

export interface SectionedSystemMessage {
  role: string;
  sections?: Record<string, unknown> | undefined;
}

export function replaceSystemPreambles<T extends SectionedSystemMessage>(
  messages: readonly T[],
  replacement: string,
): T[] {
  return messages.map((message) =>
    message.role === "system" &&
    message.sections &&
    Object.hasOwn(message.sections, "preamble")
      ? ({ ...message, sections: { ...message.sections, preamble: replacement } } as T)
      : message,
  );
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
