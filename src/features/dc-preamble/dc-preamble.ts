import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  replaceSystemPreambles,
  resolvePreambleReplacement,
  type SectionedSystemMessage,
} from "./core/dc-preamble-engine.ts";

/**
 * dc-preamble: native DC Studio replacement for the third-party
 * `replacepreambulepi` extension. On `context_with_system` (the last hook
 * before the provider request) it swaps `sections.preamble` of system
 * messages. It never creates missing preamble sections, never rewrites opaque
 * system text, and never touches persisted session history. Set the
 * `DC_PREAMBLE` environment variable to override the replacement text.
 *
 * Version note: the runtime host (pi 1.5.2) emits `context_with_system` with
 * a `messages` payload, but the pinned devDependency (pi 0.85.1) predates the
 * event, so registration goes through a cast. Run only under pi >= 1.5.x.
 */
type ContextWithSystemHandler = (
  event: { messages: SectionedSystemMessage[] },
) => { messages: SectionedSystemMessage[] } | undefined;

export default function dcPreambleExtension(
  pi: ExtensionAPI,
  env: Record<string, string | undefined> = process.env,
): void {
  const replacement = resolvePreambleReplacement(env);
  const onContextWithSystem = pi.on as unknown as (
    event: "context_with_system",
    handler: ContextWithSystemHandler,
  ) => void;
  onContextWithSystem("context_with_system", (event) => ({
    messages: replaceSystemPreambles(event.messages, replacement),
  }));
}
