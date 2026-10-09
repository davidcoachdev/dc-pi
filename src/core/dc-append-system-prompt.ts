/**
 * Helper compartido para inyectar bloques en el System Prompt de Pi de forma idempotente.
 * Sigue el mismo contrato de `lib/append-system-prompt.ts` de gentle-pi (gentle-shell#1485):
 * muta `systemPromptOptions.appendSystemPrompt` en lugar de reemplazar `systemPrompt`,
 * garantizando compatibilidad con `pi-claude-bridge`, `gentle-ai` y todos los proveedores.
 */

export interface AppendableSystemPromptOptions {
  appendSystemPrompt?: string;
}

export function appendDcSystemPromptOnce(
  options: AppendableSystemPromptOptions | null | undefined,
  text: string,
  marker?: string,
): void {
  const normalized = text.replace(/^\n+/, "").trim();
  if (!options || !normalized) return;
  const current = options.appendSystemPrompt ?? "";
  const dedupeKey = marker ? marker.trim() : normalized;
  if (dedupeKey && current.includes(dedupeKey)) return;
  options.appendSystemPrompt = current ? `${current}\n\n${normalized}` : normalized;
}
