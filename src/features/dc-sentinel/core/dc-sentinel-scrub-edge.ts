/**
 * DC Sentinel — Scrub Edge & History Compactor (Patrón Artemis TranscriptLedger)
 *
 * Aplica el principio de "Scrub Edge" descubierto en Google Artemis:
 * 1. Poda efímera: Filtra recordatorios de razonamiento, avisos de no-tool-call,
 *    guardas de sistema transitorias y secuencias ANSI antes de persistir la memoria.
 * 2. Poda a profundidad 1: Para turnos que ya salieron de la ventana activa reciente,
 *    reduce los volcados de herramientas intermedios a tuplas deterministas compactas
 *    (acción + estado), liberando memoria y previniendo la contaminación de tokens en Engram.
 */

import type {
  SentinelToolExecution,
  SentinelTurnRecord,
} from "./dc-sentinel-types.ts";

/**
 * Patrones de avisos efímeros que pertenecen únicamente a la interacción en vivo
 * y jamás deben ingresar a la bitácora histórica ni a la memoria a largo plazo.
 */
export const EPHEMERAL_NOTICE_PATTERNS: RegExp[] = [
  // Avisos de recordatorio y advertencias de arnés
  /\[WARNING\]\s+This is your final turn.*$/im,
  /You did not call any tools last turn.*$/im,
  /\[REASONING REMINDER\].*$/im,
  /<!--\s*dc:sentinel:memory-pack:(?:start|end)\s*-->/gi,
  /<SYSTEM_CUSTOM_STRATEGY_GUARD[\s\S]*?<\/SYSTEM_CUSTOM_STRATEGY_GUARD>/gi,
  /<memory-context[\s\S]*?<\/memory-context>/gi,
  // Trazas efímeras de heartbeat y progreso transitorio
  /^\s*\[heartbeat\].*$/im,
  /^\s*\[progress\].*$/im,
];

/**
 * Secuencias de escape ANSI para terminales (colores, estilos)
 */
const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

/**
 * Determina si una línea o texto completo es puramente un aviso efímero de arnés.
 */
export function isEphemeralNotice(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  const clean = text.trim();
  return EPHEMERAL_NOTICE_PATTERNS.some((pattern) => pattern.test(clean));
}

/**
 * Limpia un texto eliminando bloques efímeros, guardas de memoria inyectadas y secuencias ANSI.
 */
export function scrubEphemeralNotices(text: string): string {
  if (!text) return "";

  let cleaned = text.replace(ANSI_ESCAPE_REGEX, "");

  for (const pattern of EPHEMERAL_NOTICE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  // Colapsar saltos de línea redundantes resultantes de la eliminación
  return cleaned
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, idx, arr) => {
      // Evitar más de 2 líneas vacías consecutivas
      if (line.trim() === "" && idx > 0 && arr[idx - 1]?.trim() === "") {
        return false;
      }
      return true;
    })
    .join("\n")
    .trim();
}

/**
 * Compacta la ejecución de una herramienta antigua (Profundidad > 1):
 * Conserva el callId, nombre y si falló, pero comprime el output a una traza mínima.
 */
export function compactToolExecution(
  tool: SentinelToolExecution,
  isRecent: boolean = true,
): SentinelToolExecution {
  if (isRecent) {
    return { ...tool };
  }

  const durationMs = tool.endedAt ? Math.max(0, tool.endedAt - tool.startedAt) : undefined;
  const timing = durationMs !== undefined ? ` (${durationMs}ms)` : "";

  let compactedSnippet: string | undefined;
  if (tool.isError) {
    // Si fue error, conservar mensaje de fallo pero acotado a 120 caracteres
    const rawError = tool.outputSnippet || "Error de ejecución";
    compactedSnippet = rawError.length > 120 ? `${rawError.slice(0, 117)}...` : rawError;
  } else {
    // Si fue exitoso y es antiguo, no arrastrar payloads grandes de datos
    compactedSnippet = `[OK${timing}]`;
  }

  return {
    ...tool,
    outputSnippet: compactedSnippet,
    // Omitir argumentos gigantes en turnos antiguos para reducir huella de memoria
    args: Object.keys(tool.args || {}).length > 3 ? { _compacted: true, keys: Object.keys(tool.args) } : tool.args,
  };
}

/**
 * Aplica el Scrub Edge sobre un registro de turno individual:
 * Limpia avisos efímeros en prompts y resúmenes, y compacta las herramientas si ya no es reciente.
 */
export function scrubTurnRecord(
  turn: SentinelTurnRecord,
  isRecent: boolean = true,
): SentinelTurnRecord {
  const scrubbedPrompt = scrubEphemeralNotices(turn.userPrompt);
  const scrubbedSummary = turn.assistantSummary ? scrubEphemeralNotices(turn.assistantSummary) : undefined;

  const scrubbedTools = (turn.toolsExecuted || []).map((t) => compactToolExecution(t, isRecent));

  return {
    ...turn,
    userPrompt: scrubbedPrompt,
    assistantSummary: scrubbedSummary,
    toolsExecuted: scrubbedTools,
    // Limpiar alertas de error que fuesen únicamente avisos efímeros
    errorsDetected: (turn.errorsDetected || []).filter((err) => !isEphemeralNotice(err)),
  };
}

/**
 * Compacta el historial completo de turnos de una sesión aplicando ventana deslizante:
 * - Los últimos `recentWindowSize` turnos permanecen con detalle completo.
 * - Los turnos anteriores a la ventana sufren la poda a profundidad 1 de Artemis.
 */
export function compactTurnHistory(
  turns: SentinelTurnRecord[],
  recentWindowSize: number = 3,
): SentinelTurnRecord[] {
  if (!turns || turns.length === 0) return [];

  const total = turns.length;
  const cutoffIndex = Math.max(0, total - recentWindowSize);

  return turns.map((turn, index) => {
    const isRecent = index >= cutoffIndex;
    return scrubTurnRecord(turn, isRecent);
  });
}
